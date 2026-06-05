import type { PipelineRequestItem } from "./pipeline";

// --- Enums ---

export enum UploadKind {
  DicomZip = "dicom_zip",
  NiftiRaw = "nifti_raw",
  NiftiMask = "nifti_mask",
}

// --- Requests ---

export interface BeginUploadRequest {
  kind: UploadKind;
  filename: string;
}

export interface FinalizeRequest {
  expected_size?: number;
  pipelines?: PipelineRequestItem[];
}

// --- Responses ---

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

export interface FinalizeResponse {
  file_id: string;
  job_id: string | null;
}
