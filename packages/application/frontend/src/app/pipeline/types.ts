import type { ClientStepName, LoadingStepId, PipelineRequestItem, UploadKind } from "@/api/types";

export enum FromPage {
  Home = "home",
  Browse = "browse",
}

/** One file upload in the ordered upload phase. */
export interface UploadJob {
  file: File;
  kind: UploadKind;
  stepId: ClientStepName;
  carriesPipelines: boolean;
}

export interface UploadPayload {
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
  statusText: "Connecting...",
  connectionLost: false,
  error: null,
};
