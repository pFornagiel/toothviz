import { fetchJson } from "./client";
import type { StudyResponse, FileRecordResponse } from "./types";

export async function listStudies(
  name?: string,
): Promise<StudyResponse[]> {
  const qs = name ? `?name=${encodeURIComponent(name)}` : "";
  return fetchJson<StudyResponse[]>(`/storage/studies${qs}`);
}

export async function getStudy(studyId: string): Promise<StudyResponse> {
  return fetchJson<StudyResponse>(`/storage/studies/${studyId}`);
}

export async function createStudy(
  name?: string,
): Promise<StudyResponse> {
  return fetchJson<StudyResponse>("/storage/studies", {
    method: "POST",
    body: JSON.stringify({ name: name ?? null }),
  });
}

export async function renameStudy(
  studyId: string,
  name: string,
): Promise<StudyResponse> {
  return fetchJson<StudyResponse>(`/storage/studies/${studyId}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
}

export async function deleteStudy(studyId: string): Promise<void> {
  return fetchJson<void>(`/storage/studies/${studyId}`, { method: "DELETE" });
}

export async function listFiles(
  studyId: string,
  viewerPurpose?: string,
): Promise<FileRecordResponse[]> {
  const qs = viewerPurpose
    ? `?viewer_purpose=${encodeURIComponent(viewerPurpose)}`
    : "";
  return fetchJson<FileRecordResponse[]>(
    `/storage/studies/${studyId}/files${qs}`,
  );
}

export function fileContentUrl(studyId: string, fileId: string): string {
  return `/storage/studies/${studyId}/files/${fileId}/content`;
}
