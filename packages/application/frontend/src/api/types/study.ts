import type { LoadingStepId } from "./pipeline";

// --- Responses ---

export interface StudyResponse {
  id: string;
  name: string;
  status: string;
  created_at: string;
  job_id: string | null;
  pipeline_status: string;
  steps: LoadingStepId[];
  error: string;
  source_file_id: string | null;
}

export interface StudyListResponse {
  items: StudyResponse[];
  total: number;
  page: number;
  page_size: number;
}

export interface ListStudiesParams {
  name?: string;
  page?: number;
  pageSize?: number;
}

// --- Requests ---

export interface CreateStudyRequest {
  name?: string;
}

export interface RenameStudyRequest {
  name: string;
}
