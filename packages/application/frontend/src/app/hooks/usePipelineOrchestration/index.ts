// Public surface of the pipeline-orchestration hook. Re-exported so existing
// imports of `@/app/hooks/usePipelineOrchestration` keep working unchanged.

export {
  FromPage,
  initialState,
  type UploadPayload,
  type LocationState,
  type PipelineState,
} from "./types";

export {
  PipelineActionType,
  pipelineReducer,
  type PipelineAction,
} from "./reducer";

export { createLoadingSteps } from "./steps";
export { errorHints, CANCELLED_HINTS } from "./errorHints";
export { makeUploadProgressHandler } from "./uploadProgress";
export { applyWsMessage } from "./wsMessage";
export {
  buildPipelineCallbacks,
  connectPipeline,
  runUploadFlow,
  runReconnectFlow,
  type FlowCtx,
} from "./flows";
export { usePipelineOrchestration } from "./usePipelineOrchestration";
