export interface StudyResponse {
  id: string;
  name: string | null;
  external_id: string | null;
  status: string;
  created_at: string;
  updated_at: string | null;
  meta: Record<string, unknown>;
}

export interface CreateStudyRequest {
  external_id?: string;
  name?: string;
  meta?: Record<string, unknown>;
}

export interface RenameStudyRequest {
  name: string;
}

export type UploadKind = "dicom_zip" | "nifti_raw" | "nifti_mask";

export interface BeginUploadRequest {
  kind: UploadKind;
  filename: string;
  content_type?: string;
  expected_size?: number;
  expected_sha256?: string;
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
  name: "segment_nifti";
  config?: Record<string, unknown>;
}

export interface FinalizeRequest {
  expected_sha256?: string;
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
  pipeline_job_id: string | null;
  role: string;
  kind: string | null;
  purpose: string | null;
  original_filename: string | null;
  rel_path: string;
  blob_hash: string;
  size: number;
  content_type: string | null;
  created_at: string;
  meta: Record<string, unknown>;
}

export interface PipelineMessage {
  status?: "running" | "completed" | "failed";
  step?: string;
  progress?: number;
  error?: string;
  file_id?: string;
}
