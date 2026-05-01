import { fetchJson } from "./client";
import type { StudyResponse, FileRecordResponse } from "./types";

export async function listStudies(
  externalId?: string,
): Promise<StudyResponse[]> {
  const qs = externalId
    ? `?external_id=${encodeURIComponent(externalId)}`
    : "";
  return fetchJson<StudyResponse[]>(`/storage/studies${qs}`);
}

export async function createStudy(
  externalId: string,
  name?: string,
): Promise<StudyResponse> {
  return fetchJson<StudyResponse>("/storage/studies", {
    method: "POST",
    body: JSON.stringify({ external_id: externalId, name: name ?? externalId }),
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
  purpose?: string,
): Promise<FileRecordResponse[]> {
  const qs = purpose ? `?purpose=${encodeURIComponent(purpose)}` : "";
  return fetchJson<FileRecordResponse[]>(
    `/storage/studies/${studyId}/files${qs}`,
  );
}

export function fileContentUrl(studyId: string, fileId: string): string {
  return `/storage/studies/${studyId}/files/${fileId}/content`;
}
