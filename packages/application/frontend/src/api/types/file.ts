// --- Responses ---

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
