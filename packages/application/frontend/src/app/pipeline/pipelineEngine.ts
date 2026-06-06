import type { Dispatch } from "react";
import { ApiError } from "@/api/client";
import {
  type FinalizeResponse,
  type LoadingStepId,
  type PipelineMessage,
  type PipelineRequestItem,
  type StudyResponse,
  type UploadKind,
} from "@/api/types";
import type { UploadProgress } from "@/api/upload";
import { FromPage, type LocationState, type UploadPayload } from "./types";
import { FinishMode, PipelineActionType, type PipelineAction } from "./reducer";
import { createLoadingSteps as getLoadingSteps } from "./steps";
import { CANCELLED_HINTS, errorHints } from "./errorHints";
import { uploadStepProgress, type UploadStepLayout } from "./progress";
import { applyWsMessage } from "./wsMessage";

/** The slice of the API the engine drives - injected so it can be mocked. */
export interface PipelineApi {
  getStudy: (studyId: string) => Promise<StudyResponse>;
  deleteStudy: (studyId: string) => Promise<void>;
  uploadFile: (
    studyId: string,
    file: File,
    kind: UploadKind,
    pipelines: PipelineRequestItem[],
    onProgress?: (p: UploadProgress) => void,
  ) => Promise<FinalizeResponse>;
  establishWebsocketConnection: (
    jobId: string,
    onMessage: (msg: PipelineMessage) => void,
    onClose?: () => void,
  ) => () => void;
}

export interface PipelineEngineDeps {
  dispatch: Dispatch<PipelineAction>;
  api: PipelineApi;
  onNavigateToViewer: (studyId: string, from: FromPage) => void;
}

export interface PipelineStartParams {
  studyId: string;
  study: StudyResponse;
  routeState: LocationState;
}

export class PipelineEngine {
  private readonly dispatch: Dispatch<PipelineAction>;
  private readonly api: PipelineApi;
  private readonly onNavigateToViewer: (studyId: string, from: FromPage) => void;

  private cancelled = false;
  private finished = false;
  private connected = false;
  private disconnect: (() => void) | null = null;
  private jobId: string | null = null;
  private studyId = "";
  private routeState: LocationState = {};

  constructor({ dispatch, api, onNavigateToViewer }: PipelineEngineDeps) {
    this.dispatch = dispatch;
    this.api = api;
    this.onNavigateToViewer = onNavigateToViewer;
  }

  /** Resolve which lifecycle to run for this study and kick it off. */
  start({ studyId, study, routeState }: PipelineStartParams): void {
    this.studyId = studyId;
    this.routeState = routeState;

    if (study.status === "failed" || study.status === "cancelled") {
      let detail: string;
      if (study.error) {
        detail = study.error;
      } else if (study.status === "cancelled") {
        detail = "Processing was cancelled.";
      } else {
        detail = "Processing failed.";
      }
      this.goError("Study is not available", detail, errorHints(null));
      return;
    }

    if (routeState.uploadPayload) {
      void this.runUpload(routeState.uploadPayload);
      return;
    }

    const jobId = study.job_id ?? null;

    // No job id and not actively processing -> the initial upload state was lost which means error
    if (!jobId && study.status !== "processing") {
      this.goError("Upload state was lost", "Please create the study again from the home page.", [
        "This can happen if you refreshed during the initial upload.",
        "Use 'Create a Study' again from home.",
      ]);
      return;
    }

    // Check whether there is a job that has to be run - if not simply skip
    if (!jobId) {
      this.navigateToViewer();
      return;
    }

    this.jobId = jobId;
    void this.runReconnect(jobId);
  }

  /**
   * User-driven retry after a connection loss
   */
  reconnect(): void {
    if (this.cancelled || this.finished || this.connected) {
      return;
    }
    if (!this.jobId) {
      return;
    }
    this.dispatch({ type: PipelineActionType.ClearConnectionLost });
    void this.runReconnect(this.jobId);
  }

  /** React effect cleanup: stop all work and tear down the socket. */
  dispose(): void {
    this.cancelled = true;
    this.disconnect?.();
  }

  /** Fresh upload -> (optional further uploads) -> pipeline run over the WebSocket. */
  private async runUpload(payload: UploadPayload): Promise<void> {
    const steps = getLoadingSteps(payload);
    const { uploads, pipelines } = payload;
    const finalizeStepIndex = uploads.length;
    const uploadPrefixLen = uploads.length + 1;

    this.dispatch({ type: PipelineActionType.Begin, steps });

    try {
      let jobId: string | null = null;

      for (let i = 0; i < uploads.length; i++) {
        const job = uploads[i];
        const isLast = i === uploads.length - 1;
        const layout: UploadStepLayout = {
          stepIndex: i,
          finalizeStepIndex: isLast ? finalizeStepIndex : null,
        };

        const result = await this.api.uploadFile(
          this.studyId,
          job.file,
          job.kind,
          job.carriesPipelines ? pipelines : [],
          this.onUploadProgress(layout),
        );
        if (this.cancelled) {
          return;
        }

        if (job.carriesPipelines) {
          jobId = result.job_id;
        }

        this.dispatch({
          type: PipelineActionType.CompleteStep,
          stepIndex: isLast ? finalizeStepIndex : i,
        });
      }

      if (!jobId) {
        this.dispatch({
          type: PipelineActionType.Finish,
          mode: FinishMode.NoPipeline,
        });
        this.navigateToViewer();
        return;
      }

      this.jobId = jobId;
      this.dispatch({
        type: PipelineActionType.EnterPipeline,
        stepIndex: uploadPrefixLen,
      });
      this.connect(jobId, uploadPrefixLen);
    } catch (err: unknown) {
      if (this.cancelled) {
        return;
      }
      try {
        await this.api.deleteStudy(this.studyId);
      } catch {
        /* best-effort cleanup */
      }
      const msg = err instanceof Error ? err.message : String(err);
      this.goError("Upload failed", msg, errorHints(null));
    }
  }

  /** Reconnect to an in-flight pipeline after a reload or a dropped socket. */
  private async runReconnect(jobId: string): Promise<void> {
    let stepNames: LoadingStepId[];
    try {
      const fresh = await this.api.getStudy(this.studyId);
      if (this.cancelled) {
        return;
      }
      stepNames = fresh.steps ?? [];
      this.dispatch({ type: PipelineActionType.SetSteps, steps: stepNames });
    } catch (e: unknown) {
      if (this.cancelled) {
        return;
      }
      if (e instanceof ApiError && e.status === 404) {
        this.goError(
          "Study not found",
          "Processing may have failed and the study was removed.",
          errorHints(null),
        );
        return;
      }
      const msg = e instanceof Error ? e.message : String(e);
      this.goError("Could not load study", msg, errorHints(null));
      return;
    }

    if (this.cancelled) {
      return;
    }

    this.dispatch({
      type: PipelineActionType.EnterPipeline,
      stepIndex: stepNames.length > 0 ? 0 : null,
    });
    this.connect(jobId, 0);
  }

  /**
   * Open the pipeline WebSocket, route every message through `applyWsMessage`,
   * and store the disconnect fn. On close - while still processing - it
   * dispatches `ConnectionClosed`
   */
  private connect(jobId: string, stepOffset: number): void {
    const disconnect = this.api.establishWebsocketConnection(
      jobId,
      (msg) =>
        applyWsMessage(msg, {
          stepOffset,
          dispatch: this.dispatch,
          getPipelineFinished: () => this.finished,
          markPipelineFinished: () => {
            this.finished = true;
          },
          disconnect: () => this.disconnect?.(),
          onPipelineCompleted: () => void this.finishOk(),
          onPipelineFailed: (m) =>
            this.goError(
              "Processing failed",
              m.error ?? "The pipeline reported a failure.",
              errorHints(m.failed_step),
            ),
          onPipelineCancelled: () =>
            this.goError("Processing cancelled", "The pipeline was cancelled.", CANCELLED_HINTS),
        }),
      () => this.onClose(),
    );
    this.disconnect = disconnect;
    this.connected = true;
  }

  private onClose(): void {
    this.connected = false;
    this.disconnect = null;
    if (this.cancelled || this.finished) {
      return;
    }
    this.dispatch({ type: PipelineActionType.ConnectionClosed });
  }

  /** Build a cancellation-guarded upload progress handler for one file. */
  private onUploadProgress(layout: UploadStepLayout): (p: UploadProgress) => void {
    return (p: UploadProgress) => {
      if (this.cancelled) {
        return;
      }
      const step = uploadStepProgress(p, layout);
      if (!step) {
        return;
      }
      this.dispatch({
        type: PipelineActionType.Progress,
        stepIndex: step.stepIndex,
        fraction: step.fraction,
        statusText: step.statusText,
      });
    };
  }

  /** After a terminal `pipeline_completed`, confirm readiness and open the viewer. */
  private async finishOk(): Promise<void> {
    try {
      const fresh = await this.api.getStudy(this.studyId);
      if (this.cancelled) {
        return;
      }
      if (fresh.status === "ready") {
        this.navigateToViewer();
      }
    } catch (e: unknown) {
      if (this.cancelled) {
        return;
      }
      if (e instanceof ApiError && e.status === 404) {
        this.goError(
          "Study not found",
          "Processing may have failed and the study was removed.",
          errorHints(null),
        );
        return;
      }
      const msg = e instanceof Error ? e.message : String(e);
      this.goError("Could not load study after pipeline", msg, errorHints(null));
    }
  }

  private navigateToViewer(): void {
    this.onNavigateToViewer(this.studyId, this.routeState.from ?? FromPage.Home);
  }

  private goError(title: string, message: string, hints: string[]): void {
    this.dispatch({
      type: PipelineActionType.SetError,
      error: { title, message, hints },
    });
  }
}
