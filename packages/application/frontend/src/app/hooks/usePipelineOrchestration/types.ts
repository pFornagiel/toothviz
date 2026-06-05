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

export interface PipelineState {
  steps: LoadingStepId[];
  completedSteps: Set<number>;
  currentStepIndex: number | null;
  progress: number | null;
  statusText: string;
  error: { title: string; message: string; hints: string[] } | null;
}

export const initialState: PipelineState = {
  steps: [],
  completedSteps: new Set(),
  currentStepIndex: null,
  progress: 0,
  statusText: "Connecting…",
  error: null,
};
