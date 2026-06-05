import type { Dispatch } from "react";
import type { PipelineMessage } from "@/api/types";
import { FinishMode, PipelineActionType, type PipelineAction } from "./reducer";
import { pipelineStepProgress } from "./progress";

// ---------------------------------------------------------------------------
// WebSocket message handling. Terminal events drive the side-effect callbacks;
// non-terminal events become a `Progress` (+ `CompleteStep` on step completion).
// The only option besides the callbacks is `stepOffset`, used to globalise the
// pipeline-relative `step_index` onto the combined step list.
// ---------------------------------------------------------------------------

export interface WsHandlerOptions {
  stepOffset: number;
  dispatch: Dispatch<PipelineAction>;
  getPipelineFinished: () => boolean;
  markPipelineFinished: () => void;
  disconnect: () => void;
  onPipelineCompleted: () => void;
  onPipelineFailed: (msg: PipelineMessage) => void;
  onPipelineCancelled: () => void;
}

export function applyWsMessage(
  msg: PipelineMessage,
  {
    stepOffset,
    dispatch,
    getPipelineFinished,
    markPipelineFinished,
    disconnect,
    onPipelineCompleted,
    onPipelineFailed,
    onPipelineCancelled,
  }: WsHandlerOptions,
): void {
  if (msg.event === "pipeline_completed") {
    if (getPipelineFinished()) {
      return;
    }
    markPipelineFinished();
    disconnect();
    dispatch({ type: PipelineActionType.Finish, mode: FinishMode.Completed });
    onPipelineCompleted();
    return;
  }

  if (msg.event === "pipeline_failed") {
    if (getPipelineFinished()) {
      return;
    }
    markPipelineFinished();
    disconnect();
    onPipelineFailed(msg);
    return;
  }

  if (msg.event === "pipeline_cancelled") {
    if (getPipelineFinished()) {
      return;
    }
    markPipelineFinished();
    disconnect();
    onPipelineCancelled();
    return;
  }

  const step = pipelineStepProgress(msg);
  if (!step) {
    return;
  }

  const stepIndex = step.stepIndex + stepOffset;
  dispatch({
    type: PipelineActionType.Progress,
    stepIndex,
    fraction: step.fraction,
    statusText: step.statusText,
  });
  if (step.completed) {
    dispatch({ type: PipelineActionType.CompleteStep, stepIndex });
  }
}
