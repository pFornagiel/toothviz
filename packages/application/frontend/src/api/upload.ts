import { fetchJson } from "./client";
import type {
  UploadKind,
  BeginUploadResponse,
  FinalizeResponse,
  PipelineRequestItem,
} from "./types";

export interface UploadProgress {
  phase: "begin" | "uploading" | "finalizing" | "done";
  chunkIndex?: number;
  totalChunks?: number;
}

export async function uploadFile(
  studyId: string,
  file: File,
  kind: UploadKind,
  pipelines: PipelineRequestItem[] = [],
  onProgress?: (p: UploadProgress) => void,
): Promise<FinalizeResponse> {
  onProgress?.({ phase: "begin" });

  const { upload_id, chunk_size } = await fetchJson<BeginUploadResponse>(
    `/storage/studies/${studyId}/uploads:begin`,
    {
      method: "POST",
      body: JSON.stringify({
        kind,
        filename: file.name,
      }),
    },
  );

  const totalChunks = Math.ceil(file.size / chunk_size);

  for (let i = 0; i < totalChunks; i++) {
    onProgress?.({ phase: "uploading", chunkIndex: i, totalChunks });

    const start = i * chunk_size;
    const end = Math.min(start + chunk_size, file.size);
    const blob = file.slice(start, end);

    await fetch(`/storage/uploads/${upload_id}/chunk?index=${i}`, {
      method: "PUT",
      body: blob,
      headers: { "Content-Type": "application/octet-stream" },
    });
  }

  onProgress?.({ phase: "finalizing" });

  const result = await fetchJson<FinalizeResponse>(`/storage/uploads/${upload_id}:finalize`, {
    method: "POST",
    body: JSON.stringify({
      expected_size: file.size,
      pipelines,
    }),
  });

  onProgress?.({ phase: "done" });

  return result;
}
