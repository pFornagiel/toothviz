import type { LoadingStepId } from "./pipeline";

// --- Responses ---

export interface StudyResponse {
  id: string;
  name: string;
  status: string;
  created_at: string;
  job_id: string;
  pipeline_status: string;
  steps: LoadingStepId[];
  error: string;
  source_file_id: string | null;
}

// --- Requests ---

export interface CreateStudyRequest {
  name?: string;
}

export interface RenameStudyRequest {
  name: string;
}
