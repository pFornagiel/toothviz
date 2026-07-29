import type { LoadingStepId } from "@/api/types";
import type { PipelineError, PipelineState } from "./types";
import { clamp01 } from "./progress";

const CONNECTION_LOST_TEXT =
  "Connection lost — processing may still be running on this computer. Reopen the study from Browse Studies to continue.";

const CONNECTION_RECONNECTING_TEXT =
  "Connection lost — reconnecting to live progress…";

export enum PipelineActionType {
  Begin = "BEGIN",
  SetSteps = "SET_STEPS",
  EnterPipeline = "ENTER_PIPELINE",
  Progress = "PROGRESS",
  CompleteStep = "COMPLETE_STEP",
  Finish = "FINISH",
  SetError = "SET_ERROR",
  ConnectionClosed = "CONNECTION_CLOSED",
  SetVolumePreview = "SET_VOLUME_PREVIEW",
}

export enum FinishMode {
  Completed = "completed",
  NoPipeline = "noPipeline",
}

export type PipelineAction =
  | { type: PipelineActionType.Begin; steps: LoadingStepId[] }
  | { type: PipelineActionType.SetSteps; steps: LoadingStepId[] }
  | { type: PipelineActionType.EnterPipeline; stepIndex: number | null }
  | {
      type: PipelineActionType.Progress;
      stepIndex: number;
      fraction: number;
      statusText: string;
    }
  | { type: PipelineActionType.CompleteStep; stepIndex: number; statusText?: string }
  | { type: PipelineActionType.Finish; mode: FinishMode }
  | { type: PipelineActionType.SetError; error: PipelineError }
  | { type: PipelineActionType.ConnectionClosed; reconnecting?: boolean }
  | { type: PipelineActionType.SetVolumePreview; fileId: string };

export function pipelineReducer(state: PipelineState, action: PipelineAction): PipelineState {
  switch (action.type) {
    case PipelineActionType.Begin:
      return {
        ...state,
        steps: action.steps,
        completedSteps: new Set(),
        currentStepIndex: 0,
        progress: 0,
        statusText: "Starting upload...",
        error: null,
        volumePreviewFileId: null,
        pipelineFinished: false,
      };

    case PipelineActionType.SetSteps:
      return { ...state, steps: action.steps };

    case PipelineActionType.EnterPipeline: {
      const total = state.steps.length;
      const idx = action.stepIndex;
      return {
        ...state,
        currentStepIndex: idx,
        progress: idx != null && total > 0 ? clamp01(idx / total) : 0,
        statusText: "Pipeline running...",
      };
    }

    case PipelineActionType.Progress: {
      const total = state.steps.length;
      return {
        ...state,
        currentStepIndex: action.stepIndex,
        progress: total > 0 ? clamp01((action.stepIndex + action.fraction) / total) : 0,
        statusText: action.statusText,
      };
    }

    case PipelineActionType.CompleteStep: {
      const completedSteps = new Set(state.completedSteps);
      for (let i = 0; i <= action.stepIndex; i++) {
        completedSteps.add(i);
      }
      return {
        ...state,
        completedSteps,
        statusText: action.statusText ?? state.statusText,
      };
    }

    case PipelineActionType.Finish:
      return action.mode === FinishMode.NoPipeline
        ? {
            ...state,
            progress: 1,
            currentStepIndex: null,
            pipelineFinished: true,
            statusText: "Opening viewer...",
          }
        : {
            ...state,
            progress: 1,
            pipelineFinished: true,
            statusText: "Processing complete — loading results in viewer…",
          };

    case PipelineActionType.SetVolumePreview:
      return { ...state, volumePreviewFileId: action.fileId };

    case PipelineActionType.SetError:
      return { ...state, error: action.error };

    case PipelineActionType.ConnectionClosed:
      return {
        ...state,
        statusText: action.reconnecting ? CONNECTION_RECONNECTING_TEXT : CONNECTION_LOST_TEXT,
      };

    default:
      return state;
  }
}
