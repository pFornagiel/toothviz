import type { Dispatch } from "react";
import type { PipelineMessage } from "@/api/types";
import { PipelineActionType, type PipelineAction } from "./reducer";

// ---------------------------------------------------------------------------
// WebSocket message handling — shared by the upload and reconnect flows.
// Terminal events drive the side-effect callbacks; non-terminal events emit a
// single PIPELINE_UPDATE dispatch.
// ---------------------------------------------------------------------------

interface WsHandlerOptions {
  uploadWeight: number;
  idxOffset: number;
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
    uploadWeight,
    idxOffset,
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
    if (getPipelineFinished()) return;
    markPipelineFinished();
    disconnect();
    dispatch({ type: PipelineActionType.PipelineCompletedPending });
    onPipelineCompleted();
    return;
  }

  if (msg.event === "pipeline_failed") {
    if (getPipelineFinished()) return;
    markPipelineFinished();
    disconnect();
    onPipelineFailed(msg);
    return;
  }

  if (msg.event === "pipeline_cancelled") {
    if (getPipelineFinished()) return;
    markPipelineFinished();
    disconnect();
    onPipelineCancelled();
    return;
  }

  dispatch({ type: PipelineActionType.PipelineUpdate, msg, uploadWeight, idxOffset });
}
