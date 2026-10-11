import { fetchJson } from "./client";
import { apiUrl } from "./baseUrl";
import type { StudyResponse, StudyListResponse, ListStudiesParams, FileRecordResponse } from "./types";

export async function listStudies(params: ListStudiesParams = {}): Promise<StudyListResponse> {
  const qs = new URLSearchParams();
  if (params.name?.trim()) {
    qs.set("name", params.name.trim());
  }
  if (params.page != null) {
    qs.set("page", String(params.page));
  }
  if (params.pageSize != null) {
    qs.set("page_size", String(params.pageSize));
  }
  const query = qs.toString();
  return fetchJson<StudyListResponse>(`/storage/studies${query ? `?${query}` : ""}`);
}

export async function getStudy(studyId: string): Promise<StudyResponse> {
  return fetchJson<StudyResponse>(`/storage/studies/${studyId}`);
}

export async function createStudy(name?: string): Promise<StudyResponse> {
  return fetchJson<StudyResponse>("/storage/studies", {
    method: "POST",
    body: JSON.stringify({ name: name ?? null }),
  });
}

export async function renameStudy(studyId: string, name: string): Promise<StudyResponse> {
  return fetchJson<StudyResponse>(`/storage/studies/${studyId}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
}

export async function deleteStudy(studyId: string): Promise<void> {
  return fetchJson<void>(`/storage/studies/${studyId}`, { method: "DELETE" });
}

export async function retryStudyPipeline(studyId: string): Promise<StudyResponse> {
  return fetchJson<StudyResponse>(`/storage/studies/${studyId}/pipeline:retry`, {
    method: "POST",
  });
}

export async function cancelStudyPipeline(studyId: string): Promise<StudyResponse> {
  return fetchJson<StudyResponse>(`/storage/studies/${studyId}/pipeline:cancel`, {
    method: "POST",
  });
}

export async function listFiles(
  studyId: string,
  viewerPurpose?: string,
): Promise<FileRecordResponse[]> {
  const qs = viewerPurpose ? `?viewer_purpose=${encodeURIComponent(viewerPurpose)}` : "";
  return fetchJson<FileRecordResponse[]>(`/storage/studies/${studyId}/files${qs}`);
}

export function fileContentUrl(studyId: string, fileId: string): string {
  return apiUrl(`/storage/studies/${studyId}/files/${fileId}/content`);
}
