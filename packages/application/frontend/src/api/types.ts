export interface StudyResponse {
  id: string;
  name: string | null;
  status: string;
  created_at: string;
  job_id?: string | null;
  pipeline_status?: string | null;
  steps?: LoadingStepId[];
  error?: string | null;
  source_file_id?: string | null;
}

export interface CreateStudyRequest {
  name?: string;
}

export interface RenameStudyRequest {
  name: string;
}

export enum UploadKind {
  DicomZip = "dicom_zip",
  NiftiRaw = "nifti_raw",
  NiftiMask = "nifti_mask",
}

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
  AnonymiseDicom = "anonymyse_dicom",
}

export type LoadingStepId = PipelineStepName | ClientStepName | BackendStepName;

export enum PipelineStatus {
  Running = "running",
  Completed = "completed",
  Failed = "failed",
  Cancelled = "cancelled",
}

export interface BeginUploadRequest {
  kind: UploadKind;
  filename: string;
}

export interface BeginUploadResponse {
  upload_id: string;
  chunk_size: number;
}

export interface ChunkUploadResponse {
  index: number;
  received: number;
}

export interface UploadStatusResponse {
  upload_id: string;
  state: string;
  uploaded_chunks: number[];
}

export interface PipelineRequestItem {
  name: PipelineStepName;
  config?: Record<string, unknown>;
}

export interface FinalizeRequest {
  expected_size?: number;
  pipelines?: PipelineRequestItem[];
}

export interface FinalizeResponse {
  file_id: string;
  job_id: string | null;
}

export interface FileRecordResponse {
  id: string;
  study_id: string;
  kind: string | null;
  viewer_purpose: string | null;
  display_name: string | null;
  blob_hash: string;
  size: number;
  created_at: string;
  status: string;
}

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
