export interface StudyResponse {
  id: string;
  name: string | null;
  status: string;
  created_at: string;
  job_id?: string | null;
  pipeline_status?: string | null;
  steps?: string[];
  error?: string | null;
  source_file_id?: string | null;
}

export interface CreateStudyRequest {
  name?: string;
}

export interface RenameStudyRequest {
  name: string;
}

export type UploadKind = "dicom_zip" | "nifti_raw" | "nifti_mask";

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
  name: "segment_nifti" | "stub" | "passthrough";
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
  status?: "running" | "completed" | "failed" | "cancelled";
  step?: string;
  progress?: number;
  error?: string;
  file_id?: string;
  failed_step?: string;
  total_steps?: number;
  step_index?: number;
}
