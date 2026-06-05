import type { PipelineMessage } from "@/api/types";
import type { UploadProgress } from "@/api/upload";

// ---------------------------------------------------------------------------
// Pure progress mappers — turn raw upload/pipeline events into the single
// `(stepIndex, fractionWithinStep)` shape the reducer's unified formula consumes
// (`progress = (stepIndex + fraction) / steps.length`). All offsets/weights are
// gone: the engine globalises pipeline indices, these mappers stay offset-free.
// ---------------------------------------------------------------------------

/** A non-terminal progress update for one step of the combined step list. */
export interface StepProgress {
  /** Index into the loading-step list (pipeline indices are globalised by the engine). */
  stepIndex: number;
  /** Progress within `stepIndex`, in [0, 1]. */
  fraction: number;
  statusText: string;
}

/** Where a chunked upload's progress lands on the combined step list. */
export interface UploadStepLayout {
  /** The step that shows chunk-upload progress. */
  stepIndex: number;
  /**
   * The dedicated "Finalising" step, or `null` when this file shares the combined
   * finalize step with a later upload (then finalizing stays on `stepIndex`).
   */
  finalizeStepIndex: number | null;
}

/**
 * Map one chunked-upload progress event onto the combined step list. Returns
 * `null` for events that carry no usable progress (e.g. `uploading` with no
 * `totalChunks` yet).
 */
export function uploadStepProgress(
  upload: UploadProgress,
  { stepIndex, finalizeStepIndex }: UploadStepLayout,
): StepProgress | null {
  switch (upload.phase) {
    case "begin":
      return { stepIndex, fraction: 0, statusText: "Starting upload…" };

    case "uploading": {
      if (!upload.totalChunks) return null;
      const done = (upload.chunkIndex ?? 0) + 1;
      return {
        stepIndex,
        fraction: done / upload.totalChunks,
        statusText: `Uploading chunks ${done} / ${upload.totalChunks}`,
      };
    }

    case "finalizing":
      return finalizeStepIndex != null
        ? { stepIndex: finalizeStepIndex, fraction: 0.5, statusText: "Finalizing upload…" }
        : { stepIndex, fraction: 1, statusText: "Finalizing upload…" };

    case "done":
      return finalizeStepIndex != null
        ? { stepIndex: finalizeStepIndex, fraction: 1, statusText: "Finalizing upload…" }
        : { stepIndex, fraction: 1, statusText: "Finalizing upload…" };

    default:
      return null;
  }
}

/** A non-terminal pipeline step update, with pipeline-relative `stepIndex`. */
export interface PipelineStepProgress extends StepProgress {
  /** True for `step_completed` — the engine also marks the step in the checklist. */
  completed: boolean;
}

/**
 * Map a non-terminal pipeline WebSocket message onto a step update. `stepIndex`
 * is pipeline-relative; the engine offsets it by the upload-prefix length.
 * Returns `null` for messages with no step index. The backend sends
 * `progress = i/total` (step boundaries), so `progress * total - step_index`
 * yields the within-step fraction (0 on `step_started`, 1 on `step_completed`).
 */
export function pipelineStepProgress(msg: PipelineMessage): PipelineStepProgress | null {
  if (msg.step_index == null) return null;

  const completed = msg.event === "step_completed";
  const total = msg.total_steps ?? 0;
  const fraction =
    msg.progress != null && total > 0
      ? clamp01(msg.progress * total - msg.step_index)
      : completed
        ? 1
        : 0;

  return {
    stepIndex: msg.step_index,
    fraction,
    statusText: completed ? `Finished step: ${msg.step}` : `Started: ${msg.step}`,
    completed,
  };
}

export function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  return Math.min(1, Math.max(0, x));
}
