import type { Dispatch } from "react";
import { ApiError } from "@/api/client";
import {
  UploadKind,
  type FinalizeResponse,
  type LoadingStepId,
  type PipelineMessage,
  type PipelineRequestItem,
  type StudyResponse,
} from "@/api/types";
import type { UploadProgress } from "@/api/upload";
import { FromPage, type LocationState, type UploadPayload } from "./types";
import {
  FinishMode,
  PipelineActionType,
  type PipelineAction,
} from "./reducer";
import { createLoadingSteps } from "./steps";
import { CANCELLED_HINTS, errorHints } from "./errorHints";
import { uploadStepProgress, type UploadStepLayout } from "./progress";
import { applyWsMessage } from "./wsMessage";

// ---------------------------------------------------------------------------
// PipelineEngine — framework-agnostic orchestration. It owns every piece of
// mutable lifecycle state as a private field (no React, no react-router), so it
// can be unit-tested by injecting a mock `api` and `onNavigateToViewer`.
// ---------------------------------------------------------------------------

/** The slice of the API the engine drives — injected so it can be mocked. */
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

    // No job id and not actively processing → the initial upload state was lost
    // (e.g. a refresh during upload). Failed/cancelled already handled above.
    if (!jobId && study.status !== "processing") {
      this.goError(
        "Upload state was lost",
        "Please create the study again from the home page.",
        [
          "This can happen if you refreshed during the initial upload.",
          "Use “Create a Study” again from home.",
        ],
      );
      return;
    }

    if (!jobId) {
      this.navigateToViewer();
      return;
    }

    this.jobId = jobId;
    void this.runReconnect(jobId);
  }

  /**
   * User-driven retry after a connection loss. Repeatable (unlike the old
   * one-shot hack): guards against an already-live socket, clears the
   * connection-lost flag, and re-runs the reconnect lifecycle.
   */
  reconnect(): void {
    if (this.cancelled || this.finished || this.connected) return;
    if (!this.jobId) return;
    this.dispatch({ type: PipelineActionType.ClearConnectionLost });
    void this.runReconnect(this.jobId);
  }

  /** React effect cleanup: stop all work and tear down the socket. */
  dispose(): void {
    this.cancelled = true;
    this.disconnect?.();
  }

  // -------------------------------------------------------------------------
  // Lifecycles
  // -------------------------------------------------------------------------

  /** Fresh upload → (optional mask upload) → pipeline run over the WebSocket. */
  private async runUpload(payload: UploadPayload): Promise<void> {
    const steps = createLoadingSteps(payload);
    const hasMask = !!payload.segmentationFile;
    const uploadPrefixLen = hasMask ? 3 : 2;

    this.dispatch({ type: PipelineActionType.Begin, steps });

    try {
      // With a mask, the dedicated finalize step (index 2) belongs to the
      // combined finalize after the mask upload, so the volume's own finalize
      // stays on its upload step (finalizeStepIndex = null).
      const volumeLayout: UploadStepLayout = hasMask
        ? { stepIndex: 0, finalizeStepIndex: null }
        : { stepIndex: 0, finalizeStepIndex: 1 };

      const baseResult = await this.api.uploadFile(
        this.studyId,
        payload.baseImageFile,
        payload.baseKind,
        payload.pipelines,
        this.onUploadProgress(volumeLayout),
      );
      if (this.cancelled) return;

      this.dispatch({
        type: PipelineActionType.CompleteStep,
        stepIndex: hasMask ? 0 : 1,
      });

      if (payload.segmentationFile) {
        await this.api.uploadFile(
          this.studyId,
          payload.segmentationFile,
          UploadKind.NiftiMask,
          [],
          this.onUploadProgress({ stepIndex: 1, finalizeStepIndex: 2 }),
        );
        if (this.cancelled) return;
        this.dispatch({ type: PipelineActionType.CompleteStep, stepIndex: 2 });
      }

      if (!baseResult.job_id) {
        this.dispatch({ type: PipelineActionType.Finish, mode: FinishMode.NoPipeline });
        this.navigateToViewer();
        return;
      }

      this.jobId = baseResult.job_id;
      this.dispatch({ type: PipelineActionType.EnterPipeline, stepIndex: uploadPrefixLen });
      this.connect(baseResult.job_id, uploadPrefixLen);
    } catch (err: unknown) {
      if (this.cancelled) return;
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
    let stepNames: LoadingStepId[] = [];
    try {
      const fresh = await this.api.getStudy(this.studyId);
      if (this.cancelled) return;
      stepNames = fresh.steps ?? [];
      this.dispatch({ type: PipelineActionType.SetSteps, steps: stepNames });
    } catch (e: unknown) {
      if (this.cancelled) return;
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

    if (this.cancelled) return;

    this.dispatch({
      type: PipelineActionType.EnterPipeline,
      stepIndex: stepNames.length > 0 ? 0 : null,
    });
    this.connect(jobId, 0);
  }

  // -------------------------------------------------------------------------
  // WebSocket wiring
  // -------------------------------------------------------------------------

  /**
   * Open the pipeline WebSocket, route every message through `applyWsMessage`,
   * and store the disconnect fn. On close — while still processing — it
   * dispatches `ConnectionClosed`; it does not auto-retry (the user drives that
   * via `reconnect()`).
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
            this.goError(
              "Processing cancelled",
              "The pipeline was cancelled.",
              CANCELLED_HINTS,
            ),
        }),
      () => this.onClose(),
    );
    this.disconnect = disconnect;
    this.connected = true;
  }

  private onClose(): void {
    this.connected = false;
    this.disconnect = null;
    if (this.cancelled || this.finished) return;
    this.dispatch({ type: PipelineActionType.ConnectionClosed });
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /** Build a cancellation-guarded upload progress handler for one file. */
  private onUploadProgress(layout: UploadStepLayout): (p: UploadProgress) => void {
    return (p: UploadProgress) => {
      if (this.cancelled) return;
      const step = uploadStepProgress(p, layout);
      if (!step) return;
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
      if (this.cancelled) return;
      if (fresh.status === "ready") this.navigateToViewer();
    } catch (e: unknown) {
      if (this.cancelled) return;
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
