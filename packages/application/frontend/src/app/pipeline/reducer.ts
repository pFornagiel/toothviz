import type { LoadingStepId } from "@/api/types";
import type { PipelineError, PipelineState } from "./types";
import { clamp01 } from "./progress";

// ---------------------------------------------------------------------------
// Reducer — one geometry, one formula. The loading screen shows
// `N = steps.length` equal segments; the only truth is
// `(currentStepIndex, fractionWithinStep)` and
// `progress = clamp01((currentStepIndex + fractionWithinStep) / N)`.
//
// The engine globalises every pipeline `step_index` (adds the upload-prefix
// length) before dispatching, so the reducer never sees offsets or weights.
// ---------------------------------------------------------------------------

export enum PipelineActionType {
  Begin = "BEGIN",
  SetSteps = "SET_STEPS",
  EnterPipeline = "ENTER_PIPELINE",
  Progress = "PROGRESS",
  CompleteStep = "COMPLETE_STEP",
  Finish = "FINISH",
  SetError = "SET_ERROR",
  ConnectionClosed = "CONNECTION_CLOSED",
  ClearConnectionLost = "CLEAR_CONNECTION_LOST",
}

export enum FinishMode {
  /** Pipeline ran to completion; fill the bar and wait for the viewer to load. */
  Completed = "completed",
  /** Upload finished with no pipeline to run; jump straight to the viewer. */
  NoPipeline = "noPipeline",
}

export type PipelineAction =
  // Fresh upload: reset everything and seed the combined step list.
  | { type: PipelineActionType.Begin; steps: LoadingStepId[] }
  // Reconnect: adopt the server's step list (pure replace).
  | { type: PipelineActionType.SetSteps; steps: LoadingStepId[] }
  // Enter the pipeline phase at `stepIndex` (upload-prefix length, or 0/null on reconnect).
  | { type: PipelineActionType.EnterPipeline; stepIndex: number | null }
  // The universal non-terminal update for both upload and pipeline steps.
  | {
      type: PipelineActionType.Progress;
      stepIndex: number;
      fraction: number;
      statusText: string;
    }
  // Mark `[0..stepIndex]` complete in the checklist (steps finish in order).
  | { type: PipelineActionType.CompleteStep; stepIndex: number; statusText?: string }
  | { type: PipelineActionType.Finish; mode: FinishMode }
  | { type: PipelineActionType.SetError; error: PipelineError }
  | { type: PipelineActionType.ConnectionClosed }
  | { type: PipelineActionType.ClearConnectionLost };

const CONNECTION_CLOSED_TEXT = "Connection closed — check your network or reconnect.";

export function pipelineReducer(state: PipelineState, action: PipelineAction): PipelineState {
  switch (action.type) {
    case PipelineActionType.Begin:
      return {
        ...state,
        steps: action.steps,
        completedSteps: new Set(),
        currentStepIndex: 0,
        progress: 0,
        statusText: "Starting upload…",
        connectionLost: false,
        error: null,
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
        statusText: "Pipeline running…",
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
            statusText: "Opening viewer…",
          }
        : {
            ...state,
            progress: 1,
            statusText: "Pipeline completed — loading…",
          };

    case PipelineActionType.SetError:
      return { ...state, error: action.error };

    case PipelineActionType.ConnectionClosed:
      return { ...state, connectionLost: true, statusText: CONNECTION_CLOSED_TEXT };

    case PipelineActionType.ClearConnectionLost:
      return { ...state, connectionLost: false };
  }
}
