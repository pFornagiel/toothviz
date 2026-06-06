import type { LoadingStepId } from "./pipeline";

// --- Responses ---

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

// --- Requests ---

export interface CreateStudyRequest {
  name?: string;
}

export interface RenameStudyRequest {
  name: string;
}
