// --- Enums ---

export enum PipelineStepName {
  SegmentNifti = "segment_nifti",
  Stub = "stub",
  Passthrough = "passthrough",
}

export enum ClientStepName {
  UploadVolume = "upload_volume",
  UploadMask = "upload_mask",
  FinalizeUpload = "finalize_upload",
  LoadVolume = "load_volume",
  LoadMask = "load_mask",
}

export enum BackendStepName {
  DicomToNifti = "dicom_to_nifti",
}

export enum PipelineStatus {
  Running = "running",
  Completed = "completed",
  Failed = "failed",
  Cancelled = "cancelled",
}

export type LoadingStepId = PipelineStepName | ClientStepName | BackendStepName;

/**
 * FileRecord.viewer_purpose values used by the viewer and WS artifact maps.
 * New purposes can be added without changing the WebSocket envelope.
 */
export const ViewerPurpose = {
  Volume: "viewer_volume",
  Overlay: "viewer_overlay",
} as const;

export type ViewerPurposeId = (typeof ViewerPurpose)[keyof typeof ViewerPurpose];

/** Purpose → FileRecord id for derived (or already-bound) study files. */
export type PipelineArtifacts = Partial<Record<string, string>>;

// --- Request Items ---

export interface PipelineRequestItem {
  name: PipelineStepName;
  config?: Record<string, unknown>;
}

// --- WebSocket messages (server → client) ---

export type PipelineWsEvent =
  | "step_started"
  | "step_progress"
  | "step_completed"
  | "pipeline_completed"
  | "pipeline_failed"
  | "pipeline_cancelled";

interface PipelineWsBase {
  job_id?: string;
}

export interface PipelineWsStepStarted extends PipelineWsBase {
  event: "step_started";
  status: PipelineStatus.Running | "running";
  step: string;
  step_index: number;
  total_steps: number;
  progress: number;
  /** Present on reconnect catch-up when purposes were already committed. */
  artifacts?: PipelineArtifacts;
}

export interface PipelineWsStepProgress extends PipelineWsBase {
  event: "step_progress";
  status: PipelineStatus.Running | "running";
  step: string;
  step_index: number;
  total_steps: number;
  progress: number;
  step_progress?: number;
  chunk_index?: number;
  total_chunks?: number;
  /** Present on reconnect catch-up when purposes were already committed. */
  artifacts?: PipelineArtifacts;
}

export interface PipelineWsStepCompleted extends PipelineWsBase {
  event: "step_completed";
  step: string;
  step_index: number;
  total_steps: number;
  progress: number;
  step_progress?: number;
  /**
   * Files committed by this step, keyed by viewer purpose.
   * Used for mid-pipeline preview only — final display loads via REST.
   */
  artifacts?: PipelineArtifacts;
}

export interface PipelineWsCompleted extends PipelineWsBase {
  event: "pipeline_completed";
  status?: PipelineStatus.Completed | "completed";
  progress?: number;
}

export interface PipelineWsFailed extends PipelineWsBase {
  event: "pipeline_failed";
  status?: PipelineStatus.Failed | "failed";
  error?: string;
  failed_step?: string | null;
}

export interface PipelineWsCancelled extends PipelineWsBase {
  event: "pipeline_cancelled";
  status?: PipelineStatus.Cancelled | "cancelled";
}

export type PipelineMessage =
  | PipelineWsStepStarted
  | PipelineWsStepProgress
  | PipelineWsStepCompleted
  | PipelineWsCompleted
  | PipelineWsFailed
  | PipelineWsCancelled
  | {
      /** Frames without a recognized event are ignored by the UI. */
      event?: string;
      job_id?: string;
      status?: PipelineStatus | string;
      step?: string;
      progress?: number;
      step_progress?: number;
      error?: string;
      failed_step?: string;
      total_steps?: number;
      step_index?: number;
      chunk_index?: number;
      total_chunks?: number;
      artifacts?: PipelineArtifacts;
    };

export function artifactFileId(
  artifacts: PipelineArtifacts | undefined,
  purpose: string,
): string | undefined {
  const id = artifacts?.[purpose];
  return id || undefined;
}
