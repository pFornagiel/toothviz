import type { LoadingStepId, PipelineMessage } from "@/api/types";
import type { UploadProgress } from "@/api/upload";
import type { PipelineState } from "./types";

// ---------------------------------------------------------------------------
// Reducer — semantic, event-shaped actions. All progress math lives here.
// `totalStepsCount` is derived from `state.steps.length` (the `combinedSteps`
// length set by START_UPLOAD), so it never has to be threaded through actions.
// ---------------------------------------------------------------------------

export enum PipelineActionType {
  SetSteps = "SET_STEPS",
  SetError = "SET_ERROR",
  StartUpload = "START_UPLOAD",
  StartRunningAfterUpload = "START_RUNNING_AFTER_UPLOAD",
  StartRunningReconnect = "START_RUNNING_RECONNECT",
  UploadProgress = "UPLOAD_PROGRESS",
  PipelineUpdate = "PIPELINE_UPDATE",
  MarkUploadStepsDone = "MARK_UPLOAD_STEPS_DONE",
  UploadDoneNoPipeline = "UPLOAD_DONE_NO_PIPELINE",
  PipelineCompletedPending = "PIPELINE_COMPLETED_PENDING",
  ConnectionClosed = "CONNECTION_CLOSED",
}

export type PipelineAction =
  | { type: PipelineActionType.SetSteps; steps: LoadingStepId[] }
  | { type: PipelineActionType.SetError; title: string; message: string; hints: string[] }
  | { type: PipelineActionType.StartUpload; steps: LoadingStepId[] }
  | { type: PipelineActionType.StartRunningAfterUpload; uploadPrefixLen: number }
  | { type: PipelineActionType.StartRunningReconnect; currentStepIndex: number | null }
  | {
      // One chunked-upload progress event. The reducer turns the raw
      // `UploadProgress` + step layout into currentStepIndex/statusText/progress.
      type: PipelineActionType.UploadProgress;
      upload: UploadProgress;
      uploadStepIdx: number;
      finalizeStepIdx: number | null;
      volumeFinalizeOnSameStep: boolean;
    }
  | {
      // One non-terminal pipeline WebSocket message. The reducer blends the
      // pipeline progress over the upload weight and shifts step indices.
      type: PipelineActionType.PipelineUpdate;
      msg: PipelineMessage;
      uploadWeight: number;
      idxOffset: number;
    }
  | { type: PipelineActionType.MarkUploadStepsDone; upTo: number }
  | { type: PipelineActionType.UploadDoneNoPipeline }
  | { type: PipelineActionType.PipelineCompletedPending }
  | { type: PipelineActionType.ConnectionClosed };

const CONNECTION_CLOSED_TEXT =
  "Connection closed — check your network or refresh this page.";

export function pipelineReducer(
  state: PipelineState,
  action: PipelineAction,
): PipelineState {
  switch (action.type) {
    case PipelineActionType.SetSteps:
      return { ...state, steps: action.steps };

    case PipelineActionType.SetError:
      return {
        ...state,
        error: {
          title: action.title,
          message: action.message,
          hints: action.hints,
        },
      };

    case PipelineActionType.StartUpload:
      return {
        ...state,
        steps: action.steps,
        completedSteps: new Set(),
        currentStepIndex: 0,
        progress: 0,
        statusText: "Starting upload…",
        error: null,
      };

    case PipelineActionType.StartRunningAfterUpload: {
      const total = state.steps.length;
      const w =
        action.uploadPrefixLen > 0 ? action.uploadPrefixLen / total : 0;
      return {
        ...state,
        currentStepIndex: action.uploadPrefixLen,
        progress: w,
        statusText: "Pipeline running…",
      };
    }

    case PipelineActionType.StartRunningReconnect:
      return {
        ...state,
        statusText: "Pipeline running…",
        progress: 0,
        completedSteps: new Set(),
        currentStepIndex: action.currentStepIndex,
      };

    case PipelineActionType.UploadProgress: {
      const total = state.steps.length;
      const { upload, uploadStepIdx, finalizeStepIdx, volumeFinalizeOnSameStep } =
        action;

      if (upload.phase === "begin") {
        return {
          ...state,
          currentStepIndex: uploadStepIdx,
          statusText: "Starting upload…",
          progress: uploadStepIdx / total,
        };
      }

      if (upload.phase === "uploading" && upload.totalChunks) {
        const i = (upload.chunkIndex ?? 0) + 1;
        return {
          ...state,
          currentStepIndex: uploadStepIdx,
          statusText: `Uploading chunks ${i} / ${upload.totalChunks}`,
          progress: Math.min(
            1,
            uploadStepIdx / total + (i / upload.totalChunks) * (1 / total),
          ),
        };
      }

      if (upload.phase === "finalizing") {
        if (volumeFinalizeOnSameStep) {
          return {
            ...state,
            currentStepIndex: uploadStepIdx,
            statusText: "Finalizing upload...",
            progress: Math.min(1, (uploadStepIdx + 0.9) / total),
          };
        }
        if (finalizeStepIdx != null) {
          return {
            ...state,
            currentStepIndex: finalizeStepIdx,
            statusText: "Finalizing upload...",
            progress: (finalizeStepIdx + 0.5) / total,
          };
        }
        return state;
      }

      if (upload.phase === "done") {
        const progress =
          finalizeStepIdx != null && !volumeFinalizeOnSameStep
            ? (finalizeStepIdx + 1) / total
            : (uploadStepIdx + 1) / total;
        return { ...state, progress };
      }

      return state;
    }

    case PipelineActionType.PipelineUpdate: {
      const { msg, uploadWeight, idxOffset } = action;
      let next = state;

      const p = clamp01(msg.progress);
      if (p != null) {
        next = { ...next, progress: uploadWeight + p * (1 - uploadWeight) };
      }
      if (msg.step_index != null) {
        next = { ...next, currentStepIndex: msg.step_index + idxOffset };
      }
      if (msg.event === "step_completed" && msg.step_index != null) {
        const completedSteps = new Set(next.completedSteps);
        completedSteps.add(msg.step_index + idxOffset);
        next = {
          ...next,
          completedSteps,
          statusText: `Finished step: ${msg.step}`,
        };
      }
      if (msg.event === "step_started" && msg.step) {
        next = { ...next, statusText: `Started: ${msg.step}` };
      }
      return next;
    }

    case PipelineActionType.MarkUploadStepsDone: {
      const completedSteps = new Set<number>();
      for (let i = 0; i <= action.upTo; i++) completedSteps.add(i);
      return { ...state, completedSteps };
    }

    case PipelineActionType.UploadDoneNoPipeline:
      return {
        ...state,
        progress: 1,
        currentStepIndex: null,
        statusText: "Opening viewer…",
      };

    case PipelineActionType.PipelineCompletedPending:
      return {
        ...state,
        progress: 1,
        statusText: "Pipeline completed — loading…",
      };

    case PipelineActionType.ConnectionClosed:
      return { ...state, statusText: CONNECTION_CLOSED_TEXT };
  }
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function clamp01(x: number | undefined | null): number | undefined {
  if (x == null || Number.isNaN(x)) return undefined;
  return Math.min(1, Math.max(0, x));
}
