import type { Dispatch } from "react";
import type { PipelineMessage } from "@/api/types";
import { FinishMode, PipelineActionType, type PipelineAction } from "./reducer";
import { pipelineStepProgress } from "./progress";

export interface WsHandlerOptions {
  stepOffset: number;
  dispatch: Dispatch<PipelineAction>;
  getPipelineFinished: () => boolean;
  markPipelineFinished: () => void;
  disconnect: () => void;
  onPipelineCompleted: (msg: PipelineMessage) => void;
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
    onPipelineCompleted(msg);
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
  if (msg.step_index != null && msg.step_index > 0) {
    dispatch({
      type: PipelineActionType.CompleteStep,
      stepIndex: msg.step_index + stepOffset - 1,
    });
  }
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
