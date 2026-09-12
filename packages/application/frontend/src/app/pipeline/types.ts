import type { ClientStepName, LoadingStepId, PipelineRequestItem, UploadKind } from "@/api/types";

export enum FromPage {
  Home = "home",
  Browse = "browse",
}

/** Navigation state passed from the pipeline engine into the visualization page. */
export interface ViewerNavigationOptions {
  from: FromPage;
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
  /** Restored when returning from raw-scan preview during processing. */
  volumePreviewFileId?: string | null;
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
  error: PipelineError | null;
  /** Volume file id when raw scan can be previewed during processing. */
  volumePreviewFileId: string | null;
  /** True after pipeline_completed until navigation away. */
  pipelineFinished: boolean;
  /** True once the server pipeline starts (after upload / on resume). */
  pipelineActive: boolean;
}

/** What `usePipeline()` returns from the pipeline reducer. */
export type PipelineContextValue = PipelineState & {
  retryFailedPipeline?: () => void;
  canRetry?: boolean;
  /** True while a retry request is in flight. */
  retrying?: boolean;
  /** Stop in-flight server processing; keeps the study for retry. */
  cancelPipeline?: () => void;
  /** True while a cancel request is in flight. */
  cancelling?: boolean;
};

export const initialState: PipelineState = {
  steps: [],
  completedSteps: new Set(),
  currentStepIndex: null,
  progress: 0,
  statusText: "Connecting...",
  error: null,
  volumePreviewFileId: null,
  pipelineFinished: false,
  pipelineActive: false,
};
