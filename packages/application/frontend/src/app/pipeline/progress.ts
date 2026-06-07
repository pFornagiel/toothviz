import type { PipelineMessage } from "@/api/types";
import type { UploadProgress } from "@/api/upload";

const STEP_LABELS: Record<string, string> = {
  segment_nifti: "Segmenting volume",
  dicom_to_nifti: "Converting DICOM",
  stub: "Processing",
  passthrough: "Processing",
};

function stepLabel(step: string | undefined): string {
  if (!step) {
    return "Processing";
  }
  return STEP_LABELS[step] ?? step;
}

function pipelineStepStatusText(
  msg: PipelineMessage,
  completed: boolean,
  fraction: number,
): string {
  const label = stepLabel(msg.step);
  const mapped = msg.step != null && msg.step in STEP_LABELS;

  if (completed) {
    return mapped ? `${label} complete` : `Finished step: ${msg.step}`;
  }

  if (msg.event === "step_progress" && mapped) {
    if (
      msg.step === "segment_nifti" &&
      msg.total_chunks != null &&
      msg.chunk_index != null
    ) {
      const done = msg.chunk_index + 1;
      return `Segmenting chunk ${done} / ${msg.total_chunks}`;
    }
    const pct = Math.round((msg.step_progress ?? fraction) * 100);
    return `${label}… ${pct}%`;
  }

  return mapped ? `${label}…` : `Started: ${msg.step}`;
}
/** A non-terminal progress update for one step of the combined step list. */
export interface StepProgress {
  stepIndex: number;
  fraction: number;
  statusText: string;
}

/** Where a chunked upload's progress lands on the combined step list. */
export interface UploadStepLayout {
  stepIndex: number;
  /**
   * The dedicated "Finalising" step, or `null` when this file shares the combined
   * finalize step with a later upload.
   */
  finalizeStepIndex: number | null;
}

/**
 * Map one chunked-upload progress event onto the combined step list. Returns
 * `null` for events that carry no usable progress.
 */
export function uploadStepProgress(
  upload: UploadProgress,
  { stepIndex, finalizeStepIndex }: UploadStepLayout,
): StepProgress | null {
  switch (upload.phase) {
    case "begin":
      return { stepIndex, fraction: 0, statusText: "Starting upload..." };

    case "uploading": {
      if (!upload.totalChunks) {
        return null;
      }
      const done = (upload.chunkIndex ?? 0) + 1;
      return {
        stepIndex,
        fraction: done / upload.totalChunks,
        statusText: `Uploading chunks ${done} / ${upload.totalChunks}`,
      };
    }

    case "finalizing":
      return finalizeStepIndex != null
        ? { stepIndex: finalizeStepIndex, fraction: 0.5, statusText: "Finalizing upload..." }
        : { stepIndex, fraction: 1, statusText: "Finalizing upload..." };

    case "done":
      return finalizeStepIndex != null
        ? { stepIndex: finalizeStepIndex, fraction: 1, statusText: "Finalizing upload..." }
        : { stepIndex, fraction: 1, statusText: "Finalizing upload..." };

    default:
      return null;
  }
}

/** A non-terminal pipeline step update, with pipeline-relative `stepIndex`. */
export interface PipelineStepProgress extends StepProgress {
  completed: boolean;
}

/**
 * Map a non-terminal pipeline WebSocket message onto a step update.
 */
export function pipelineStepProgress(msg: PipelineMessage): PipelineStepProgress | null {
  if (msg.step_index == null) {
    return null;
  }

  const completed = msg.event === "step_completed";
  const total = msg.total_steps ?? 0;
  const fraction =
    msg.total_chunks != null && msg.chunk_index != null && msg.total_chunks > 0
      ? clamp01((msg.chunk_index + 1) / msg.total_chunks)
      : msg.progress != null && total > 0
        ? clamp01(msg.progress * total - msg.step_index)
        : completed
          ? 1
          : 0;

  return {
    stepIndex: msg.step_index,
    fraction,
    statusText: pipelineStepStatusText(msg, completed, fraction),
    completed,
  };
}

export function clamp01(x: number): number {
  if (Number.isNaN(x)) {
    return 0;
  }
  return Math.min(1, Math.max(0, x));
}
