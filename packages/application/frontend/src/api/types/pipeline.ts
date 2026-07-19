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
}

export interface PipelineWsStepCompleted extends PipelineWsBase {
  event: "step_completed";
  step: string;
  step_index: number;
  total_steps: number;
  progress: number;
  step_progress?: number;
  volume_file_id?: string | null;
}

export interface PipelineWsCompleted extends PipelineWsBase {
  event: "pipeline_completed";
  status?: PipelineStatus.Completed | "completed";
  progress?: number;
  volume_file_id?: string | null;
  overlay_file_id?: string | null;
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
      volume_file_id?: string | null;
      overlay_file_id?: string | null;
    };
