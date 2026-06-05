import type { LoadingStepId, PipelineRequestItem, UploadKind } from "@/api/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export enum FromPage {
  Home = "home",
  Browse = "browse",
}

export interface UploadPayload {
  baseImageFile: File;
  baseKind: UploadKind;
  pipelines: PipelineRequestItem[];
  segmentationFile?: File;
}

export interface LocationState {
  uploadPayload?: UploadPayload;
  jobId?: string | null;
  from?: FromPage;
}

export interface PipelineError {
  title: string;
  message: string;
  hints: string[];
}

export interface PipelineState {
  steps: LoadingStepId[];
  completedSteps: Set<number>;
  currentStepIndex: number | null;
  progress: number | null;
  statusText: string;
  /** True once the pipeline WebSocket closed mid-run; drives the Reconnect UI. */
  connectionLost: boolean;
  error: PipelineError | null;
}

/** What `usePipeline()` returns: the reducer state plus the imperative actions. */
export interface PipelineContextValue extends PipelineState {
  reconnect: () => void;
}

export const initialState: PipelineState = {
  steps: [],
  completedSteps: new Set(),
  currentStepIndex: null,
  progress: 0,
  statusText: "Connecting…",
  connectionLost: false,
  error: null,
};
