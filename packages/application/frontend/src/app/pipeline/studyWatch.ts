import type { StudyResponse } from "@/api/types";

export const STUDY_TERMINAL_POLL_MS = 5_000;

export type TerminalStudyStatus = "ready" | "failed" | "cancelled";

export function isTerminalStudyStatus(status: string): status is TerminalStudyStatus {
  return status === "ready" || status === "failed" || status === "cancelled";
}

export interface WatchStudyUntilTerminalOptions {
  getStudy: (studyId: string) => Promise<StudyResponse>;
  studyId: string;
  intervalMs?: number;
  /** Invoked once when status becomes ready / failed / cancelled; polling then stops. */
  onTerminal: (study: StudyResponse) => void | Promise<void>;
  /** Optional filter: skip invoking onTerminal until this returns true. */
  shouldHandle?: (study: StudyResponse) => boolean;
  isCancelled?: () => boolean;
}

/**
 * Poll a study until it reaches a terminal status (or the caller cancels).
 * Stops automatically after the first handled terminal event.
 * Returns a dispose function that clears the interval.
 */
export function watchStudyUntilTerminal({
  getStudy,
  studyId,
  intervalMs = STUDY_TERMINAL_POLL_MS,
  onTerminal,
  shouldHandle,
  isCancelled,
}: WatchStudyUntilTerminalOptions): () => void {
  let disposed = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const stop = () => {
    disposed = true;
    if (timer != null) {
      clearInterval(timer);
      timer = null;
    }
  };

  const tick = async () => {
    if (disposed || isCancelled?.()) {
      return;
    }
    try {
      const study = await getStudy(studyId);
      if (disposed || isCancelled?.()) {
        return;
      }
      if (!isTerminalStudyStatus(study.status)) {
        return;
      }
      if (shouldHandle && !shouldHandle(study)) {
        return;
      }
      // Stop before awaiting onTerminal so overlapping ticks cannot re-enter.
      stop();
      try {
        await onTerminal(study);
      } catch {
        /* caller owns error UI; polling already stopped */
      }
    } catch {
      /* best-effort while waiting for a terminal status */
    }
  };

  void tick();
  timer = setInterval(() => {
    void tick();
  }, intervalMs);

  return stop;
}
