import type { Dispatch } from "react";
import { ApiError } from "@/api/client";
import {
  type FinalizeResponse,
  type LoadingStepId,
  type PipelineMessage,
  type PipelineRequestItem,
  type StudyResponse,
  UploadKind,
} from "@/api/types";
import type { UploadProgress } from "@/api/upload";
import type { FileRecordResponse } from "@/api/types";
import { FromPage, type LocationState, type UploadPayload, type ViewerNavigationOptions } from "./types";
import { FinishMode, PipelineActionType, type PipelineAction } from "./reducer";
import { createLoadingSteps as getLoadingSteps } from "./steps";
import { CANCELLED_HINTS, errorHints } from "./errorHints";
import { uploadStepProgress, type UploadStepLayout } from "./progress";
import { applyWsMessage } from "./wsMessage";
import { watchStudyUntilTerminal, STUDY_TERMINAL_POLL_MS } from "./studyWatch";
import { resolveViewerFileIds } from "./viewerFiles";

const WS_RECONNECT_MAX_ATTEMPTS = 5;
const WS_RECONNECT_BASE_MS = 1_000;

/** The slice of the API the engine drives - injected so it can be mocked. */
export interface PipelineApi {
  getStudy: (studyId: string) => Promise<StudyResponse>;
  deleteStudy: (studyId: string) => Promise<void>;
  listFiles: (studyId: string, viewerPurpose?: string) => Promise<FileRecordResponse[]>;
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
  onNavigateToViewer: (studyId: string, options: ViewerNavigationOptions) => void;
}

export interface PipelineStartParams {
  studyId: string;
  study: StudyResponse;
  routeState: LocationState;
}

export class PipelineEngine {
  private readonly dispatch: Dispatch<PipelineAction>;
  private readonly api: PipelineApi;
  private readonly onNavigateToViewer: (studyId: string, options: ViewerNavigationOptions) => void;

  private cancelled = false;
  private finished = false;
  private disconnect: (() => void) | null = null;
  private stopTerminalPoll: (() => void) | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private intentionalClose = false;
  private activeJobId: string | null = null;
  private stepOffset = 0;
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

    if (study.status === "ready") {
      this.navigateToViewer();
      return;
    }

    if (routeState.uploadPayload) {
      void this.runUpload(routeState.uploadPayload);
      return;
    }

    if (study.status === "processing" && !study.job_id) {
      this.navigateToViewer();
      return;
    }

    if (!study.job_id) {
      this.goError("Upload state was lost", "Please create the study again from the home page.", [
        "This can happen if you refreshed during the initial upload.",
        "Use 'Create a Study' again from home.",
      ]);
      return;
    }

    void this.resumeProcessing();
  }

  /** React effect cleanup: stop all work and tear down the socket. */
  dispose(): void {
    this.cancelled = true;
    this.clearReconnectTimer();
    this.clearTerminalPoll();
    this.intentionalClose = true;
    this.disconnect?.();
    this.disconnect = null;
    this.intentionalClose = false;
  }

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

        if (job.kind === UploadKind.NiftiRaw) {
          this.dispatch({
            type: PipelineActionType.SetVolumePreview,
            fileId: result.file_id,
          });
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

  private async resumeProcessing(): Promise<void> {
    try {
      const fresh = await this.api.getStudy(this.studyId);
      if (this.cancelled) {
        return;
      }

      if (this.handleTerminalStudyStatus(fresh)) {
        return;
      }

      if (!fresh.job_id) {
        this.goError(
          "Processing unavailable",
          "No active pipeline job was found for this study.",
          errorHints(null),
        );
        return;
      }

      await this.attachToRunningJob(fresh);
    } catch (e: unknown) {
      if (this.cancelled) {
        return;
      }
      if (e instanceof ApiError && e.status === 404) {
        this.goError("Study not found", "The study could not be found.", errorHints(null));
        return;
      }
      const msg = e instanceof Error ? e.message : String(e);
      this.goError("Could not load study", msg, errorHints(null));
    }
  }

  /** Adopt server steps, restore volume preview if present, enter pipeline UI, connect WS. */
  private async attachToRunningJob(study: StudyResponse): Promise<void> {
    const jobId = study.job_id;
    if (!jobId) {
      this.goError(
        "Processing unavailable",
        "No active pipeline job was found for this study.",
        errorHints(null),
      );
      return;
    }

    const stepNames = (study.steps ?? []) as LoadingStepId[];
    this.dispatch({ type: PipelineActionType.SetSteps, steps: stepNames });
    await this.restorePreviewVolume();
    if (this.cancelled) {
      return;
    }

    this.dispatch({
      type: PipelineActionType.EnterPipeline,
      stepIndex: stepNames.length > 0 ? 0 : null,
    });
    this.connect(jobId, 0);
  }

  private connect(jobId: string, stepOffset: number): void {
    this.activeJobId = jobId;
    this.stepOffset = stepOffset;
    this.clearReconnectTimer();

    this.intentionalClose = true;
    this.disconnect?.();
    this.disconnect = null;
    this.intentionalClose = false;

    this.startTerminalPoll();

    const disconnect = this.api.establishWebsocketConnection(
      jobId,
      (msg) => {
        // A live frame means the socket is healthy again.
        this.reconnectAttempts = 0;
        applyWsMessage(msg, {
          stepOffset,
          dispatch: this.dispatch,
          getPipelineFinished: () => this.finished,
          markPipelineFinished: () => {
            this.finished = true;
          },
          disconnect: () => {
            this.intentionalClose = true;
            this.disconnect?.();
            this.disconnect = null;
            this.intentionalClose = false;
          },
          onPipelineCompleted: (m) => void this.finishOk(m),
          onPipelineFailed: (m) => {
            this.goError(
              "Processing failed",
              m.error ?? "The pipeline reported a failure.",
              errorHints(m.failed_step),
            );
          },
          onPipelineCancelled: () => {
            this.goError("Processing cancelled", "The pipeline was cancelled.", CANCELLED_HINTS);
          },
        });
      },
      () => this.onClose(),
    );
    this.disconnect = disconnect;
  }

  private onClose(): void {
    if (this.intentionalClose || this.cancelled || this.finished) {
      return;
    }
    this.disconnect = null;
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.cancelled || this.finished || !this.activeJobId) {
      return;
    }
    if (this.reconnectAttempts >= WS_RECONNECT_MAX_ATTEMPTS) {
      this.dispatch({ type: PipelineActionType.ConnectionClosed, reconnecting: false });
      return;
    }

    this.reconnectAttempts += 1;
    this.dispatch({ type: PipelineActionType.ConnectionClosed, reconnecting: true });

    const delay = WS_RECONNECT_BASE_MS * 2 ** (this.reconnectAttempts - 1);
    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.cancelled || this.finished || !this.activeJobId) {
        return;
      }
      this.connect(this.activeJobId, this.stepOffset);
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer != null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private startTerminalPoll(): void {
    this.clearTerminalPoll();
    this.stopTerminalPoll = watchStudyUntilTerminal({
      getStudy: this.api.getStudy,
      studyId: this.studyId,
      intervalMs: STUDY_TERMINAL_POLL_MS,
      isCancelled: () => this.cancelled || this.finished,
      onTerminal: (fresh) => {
        this.handleTerminalStudyStatus(fresh);
      },
    });
  }

  private clearTerminalPoll(): void {
    this.stopTerminalPoll?.();
    this.stopTerminalPoll = null;
  }

  /** @returns true when a terminal status was handled (ready / failed / cancelled). */
  private handleTerminalStudyStatus(fresh: StudyResponse): boolean {
    if (fresh.status === "ready") {
      this.finished = true;
      this.clearReconnectTimer();
      this.clearTerminalPoll();
      this.intentionalClose = true;
      this.disconnect?.();
      this.disconnect = null;
      this.intentionalClose = false;
      this.dispatch({ type: PipelineActionType.Finish, mode: FinishMode.Completed });
      this.navigateToViewer();
      return true;
    }

    if (fresh.status === "failed" || fresh.status === "cancelled") {
      this.finished = true;
      const detail =
        fresh.error ??
        (fresh.status === "cancelled"
          ? "The pipeline was cancelled."
          : "The pipeline reported a failure.");
      this.goError(
        fresh.status === "cancelled" ? "Processing cancelled" : "Processing failed",
        detail,
        fresh.status === "cancelled" ? CANCELLED_HINTS : errorHints(null),
      );
      return true;
    }

    return false;
  }

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

  private async finishOk(msg: PipelineMessage): Promise<void> {
    this.clearReconnectTimer();
    this.clearTerminalPoll();
    this.intentionalClose = true;
    this.disconnect?.();
    this.disconnect = null;
    this.intentionalClose = false;

    let volumeFileId = msg.volume_file_id ?? undefined;
    let overlayFileId = msg.overlay_file_id ?? undefined;

    // NIfTI source volumes are not always in the completion frame; resolve from
    // study files so the viewer always gets image + mask when both exist.
    if (volumeFileId == null || overlayFileId == null) {
      try {
        const resolved = await resolveViewerFileIds(this.api.listFiles, this.studyId, {
          volumeFileId,
          overlayFileId,
        });
        volumeFileId = resolved.volumeFileId ?? volumeFileId;
        overlayFileId = resolved.overlayFileId ?? overlayFileId;
      } catch {
        /* fall through with whatever ids we have */
      }
    }

    if (volumeFileId != null || overlayFileId != null) {
      this.navigateToViewer({
        ...msg,
        volume_file_id: volumeFileId ?? null,
        overlay_file_id: overlayFileId ?? null,
      });
      return;
    }

    try {
      const fresh = await this.api.getStudy(this.studyId);
      if (this.cancelled) {
        return;
      }
      if (fresh.status === "ready") {
        this.navigateToViewer();
        return;
      }
      this.goError(
        "Processing incomplete",
        "The pipeline finished but the study is not ready yet. Try reopening from Browse Studies.",
        errorHints(null),
      );
    } catch (e: unknown) {
      if (this.cancelled) {
        return;
      }
      if (e instanceof ApiError && e.status === 404) {
        this.goError("Study not found", "The study could not be found.", errorHints(null));
        return;
      }
      const detail = e instanceof Error ? e.message : String(e);
      this.goError("Could not load study after pipeline", detail, errorHints(null));
    }
  }

  private navigateToViewer(msg?: PipelineMessage): void {
    this.onNavigateToViewer(this.studyId, {
      from: this.routeState.from ?? FromPage.Home,
      volumeFileId: msg?.volume_file_id,
      overlayFileId: msg?.overlay_file_id,
    });
  }

  private async restorePreviewVolume(): Promise<void> {
    try {
      const { volumeFileId } = await resolveViewerFileIds(this.api.listFiles, this.studyId);
      if (volumeFileId) {
        this.dispatch({
          type: PipelineActionType.SetVolumePreview,
          fileId: volumeFileId,
        });
      }
    } catch {
      /* preview is optional */
    }
  }

  private goError(title: string, message: string, hints: string[]): void {
    this.clearReconnectTimer();
    this.clearTerminalPoll();
    this.intentionalClose = true;
    this.disconnect?.();
    this.disconnect = null;
    this.intentionalClose = false;
    this.dispatch({
      type: PipelineActionType.SetError,
      error: { title, message, hints },
    });
  }
}
