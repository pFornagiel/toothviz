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

// --- Messages ---

export interface PipelineMessage {
  event?: string;
  job_id?: string;
  status?: PipelineStatus;
  step?: string;
  progress?: number;
  error?: string;
  file_id?: string;
  failed_step?: string;
  total_steps?: number;
  step_index?: number;
}
