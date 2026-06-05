import type { ClientStepName, LoadingStepId, PipelineRequestItem, UploadKind } from "@/api/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export enum FromPage {
  Home = "home",
  Browse = "browse",
}

/** One file upload in the ordered upload phase. */
export interface UploadJob {
  file: File;
  kind: UploadKind;
  /** Loading-step label this upload shows under (e.g. UploadVolume, UploadMask). */
  stepId: ClientStepName;
  /** Exactly one job per payload is true: it sends `pipelines` on finalize and yields the job_id. */
  carriesPipelines: boolean;
}

export interface UploadPayload {
  /** Ordered upload phase: volume first, optional mask second, … */
  uploads: UploadJob[];
  pipelines: PipelineRequestItem[];
}

export interface LocationState {
  uploadPayload?: UploadPayload;
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
