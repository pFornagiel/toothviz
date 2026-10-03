import type { StudyResponse } from "@/api/types";

export type TerminalStudyStatus = "ready" | "failed" | "cancelled";

export function isTerminalStudyStatus(status: string): status is TerminalStudyStatus {
  return status === "ready" || status === "failed" || status === "cancelled";
}

export function isProcessingStudy(study: Pick<StudyResponse, "status">): boolean {
  return study.status === "processing";
}

export function isFailedOrCancelled(status: string): boolean {
  return status === "failed" || status === "cancelled";
}

/** Retry is offered for failed/cancelled studies that still have a source upload. */
export function canRetryStudy(
  study: Pick<StudyResponse, "status" | "source_file_id">,
): boolean {
  return isFailedOrCancelled(study.status) && Boolean(study.source_file_id);
}

/** Cancel is offered while the study is still processing. */
export function canCancelStudy(study: Pick<StudyResponse, "status">): boolean {
  return isProcessingStudy(study);
}
