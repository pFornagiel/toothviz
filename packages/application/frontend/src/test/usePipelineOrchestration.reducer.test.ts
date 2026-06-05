import { describe, it, expect } from "vitest";
import {
  pipelineReducer,
  initialState,
  PipelineActionType,
  type PipelineState,
} from "@/app/hooks/usePipelineOrchestration";
import {
  ClientStepName,
  PipelineStepName,
} from "@/api/types";

// No-mask layout: [UploadVolume, FinalizeUpload, <pipeline>] → total 3.
const noMaskSteps = [
  ClientStepName.UploadVolume,
  ClientStepName.FinalizeUpload,
  PipelineStepName.SegmentNifti,
];

// Mask layout: [UploadVolume, UploadMask, FinalizeUpload, <pipeline>] → total 4.
const maskSteps = [
  ClientStepName.UploadVolume,
  ClientStepName.UploadMask,
  ClientStepName.FinalizeUpload,
  PipelineStepName.SegmentNifti,
];

function stateWithSteps(steps: PipelineState["steps"]): PipelineState {
  return { ...initialState, steps };
}

describe("pipelineReducer — lifecycle actions", () => {
  it("START_UPLOAD resets progress and seeds the step list", () => {
    const next = pipelineReducer(initialState, {
      type: PipelineActionType.StartUpload,
      steps: noMaskSteps,
    });
    expect(next.steps).toEqual(noMaskSteps);
    expect(next.completedSteps).toEqual(new Set());
    expect(next.currentStepIndex).toBe(0);
    expect(next.progress).toBe(0);
    expect(next.statusText).toBe("Starting upload…");
    expect(next.error).toBeNull();
  });

  it("START_RUNNING_AFTER_UPLOAD derives the upload weight from steps.length", () => {
    const next = pipelineReducer(stateWithSteps(noMaskSteps), {
      type: PipelineActionType.StartRunningAfterUpload,
      uploadPrefixLen: 2,
    });
    expect(next.currentStepIndex).toBe(2);
    expect(next.progress).toBeCloseTo(2 / 3, 10);
    expect(next.statusText).toBe("Pipeline running…");
  });

  it("START_RUNNING_AFTER_UPLOAD yields weight 0 for a zero prefix", () => {
    const next = pipelineReducer(stateWithSteps(noMaskSteps), {
      type: PipelineActionType.StartRunningAfterUpload,
      uploadPrefixLen: 0,
    });
    expect(next.progress).toBe(0);
    expect(next.currentStepIndex).toBe(0);
  });

  it("START_RUNNING_RECONNECT resets progress and sets the current step", () => {
    const next = pipelineReducer(stateWithSteps(noMaskSteps), {
      type: PipelineActionType.StartRunningReconnect,
      currentStepIndex: 0,
    });
    expect(next.progress).toBe(0);
    expect(next.completedSteps).toEqual(new Set());
    expect(next.currentStepIndex).toBe(0);
    expect(next.statusText).toBe("Pipeline running…");
  });

  it("SET_ERROR records the error detail", () => {
    const next = pipelineReducer(initialState, {
      type: PipelineActionType.SetError,
      title: "T",
      message: "M",
      hints: ["h"],
    });
    expect(next.error).toEqual({ title: "T", message: "M", hints: ["h"] });
  });

  it("SET_STEPS replaces only the step list", () => {
    const next = pipelineReducer(initialState, {
      type: PipelineActionType.SetSteps,
      steps: maskSteps,
    });
    expect(next.steps).toEqual(maskSteps);
  });
});

describe("pipelineReducer — UPLOAD_PROGRESS (no-mask base: idx 0, finalize 1)", () => {
  const base = stateWithSteps(noMaskSteps); // total 3

  it("begin", () => {
    const next = pipelineReducer(base, {
      type: PipelineActionType.UploadProgress,
      upload: { phase: "begin" },
      uploadStepIdx: 0,
      finalizeStepIdx: 1,
      volumeFinalizeOnSameStep: false,
    });
    expect(next.currentStepIndex).toBe(0);
    expect(next.statusText).toBe("Starting upload…");
    expect(next.progress).toBe(0);
  });

  it("uploading chunk 1 of 4", () => {
    const next = pipelineReducer(base, {
      type: PipelineActionType.UploadProgress,
      upload: { phase: "uploading", chunkIndex: 0, totalChunks: 4 },
      uploadStepIdx: 0,
      finalizeStepIdx: 1,
      volumeFinalizeOnSameStep: false,
    });
    expect(next.currentStepIndex).toBe(0);
    expect(next.statusText).toBe("Uploading chunks 1 / 4");
    expect(next.progress).toBeCloseTo(0 / 3 + (1 / 4) * (1 / 3), 10);
  });

  it("uploading is ignored without totalChunks", () => {
    const next = pipelineReducer(base, {
      type: PipelineActionType.UploadProgress,
      upload: { phase: "uploading", chunkIndex: 0 },
      uploadStepIdx: 0,
      finalizeStepIdx: 1,
      volumeFinalizeOnSameStep: false,
    });
    expect(next).toBe(base);
  });

  it("finalizing moves to the finalize step", () => {
    const next = pipelineReducer(base, {
      type: PipelineActionType.UploadProgress,
      upload: { phase: "finalizing" },
      uploadStepIdx: 0,
      finalizeStepIdx: 1,
      volumeFinalizeOnSameStep: false,
    });
    expect(next.currentStepIndex).toBe(1);
    expect(next.statusText).toBe("Finalizing upload...");
    expect(next.progress).toBeCloseTo((1 + 0.5) / 3, 10);
  });

  it("done advances past the finalize step without touching status/index", () => {
    const next = pipelineReducer(
      { ...base, currentStepIndex: 1, statusText: "Finalizing upload..." },
      {
        type: PipelineActionType.UploadProgress,
        upload: { phase: "done" },
        uploadStepIdx: 0,
        finalizeStepIdx: 1,
        volumeFinalizeOnSameStep: false,
      },
    );
    expect(next.progress).toBeCloseTo((1 + 1) / 3, 10);
    expect(next.currentStepIndex).toBe(1);
    expect(next.statusText).toBe("Finalizing upload...");
  });
});

describe("pipelineReducer — UPLOAD_PROGRESS (mask volume: idx 0, same-step finalize)", () => {
  const base = stateWithSteps(maskSteps); // total 4

  it("finalizing on the same step uses the 0.9 nudge", () => {
    const next = pipelineReducer(base, {
      type: PipelineActionType.UploadProgress,
      upload: { phase: "finalizing" },
      uploadStepIdx: 0,
      finalizeStepIdx: null,
      volumeFinalizeOnSameStep: true,
    });
    expect(next.currentStepIndex).toBe(0);
    expect(next.statusText).toBe("Finalizing upload...");
    expect(next.progress).toBeCloseTo((0 + 0.9) / 4, 10);
  });

  it("done falls back to (uploadStepIdx + 1) when on the same step", () => {
    const next = pipelineReducer(base, {
      type: PipelineActionType.UploadProgress,
      upload: { phase: "done" },
      uploadStepIdx: 0,
      finalizeStepIdx: null,
      volumeFinalizeOnSameStep: true,
    });
    expect(next.progress).toBeCloseTo((0 + 1) / 4, 10);
  });

  it("mask file (idx 1, finalize 2) finalizing", () => {
    const next = pipelineReducer(base, {
      type: PipelineActionType.UploadProgress,
      upload: { phase: "finalizing" },
      uploadStepIdx: 1,
      finalizeStepIdx: 2,
      volumeFinalizeOnSameStep: false,
    });
    expect(next.currentStepIndex).toBe(2);
    expect(next.progress).toBeCloseTo((2 + 0.5) / 4, 10);
  });
});

describe("pipelineReducer — PIPELINE_UPDATE", () => {
  // After upload, prefix 2 of 3 steps done → weight 2/3, offset 2.
  const base: PipelineState = {
    ...stateWithSteps(noMaskSteps),
    completedSteps: new Set(),
    currentStepIndex: 2,
    progress: 2 / 3,
  };
  const uploadWeight = 2 / 3;
  const idxOffset = 2;

  it("blends progress over the upload weight and shifts the step index", () => {
    const next = pipelineReducer(base, {
      type: PipelineActionType.PipelineUpdate,
      msg: { event: "step_started", step: "segment", progress: 0.5, step_index: 0 },
      uploadWeight,
      idxOffset,
    });
    expect(next.progress).toBeCloseTo(uploadWeight + 0.5 * (1 - uploadWeight), 10);
    expect(next.currentStepIndex).toBe(2);
    expect(next.statusText).toBe("Started: segment");
  });

  it("clamps incoming progress to [0,1] before blending", () => {
    const next = pipelineReducer(base, {
      type: PipelineActionType.PipelineUpdate,
      msg: { progress: 1.5 },
      uploadWeight,
      idxOffset,
    });
    expect(next.progress).toBeCloseTo(uploadWeight + 1 * (1 - uploadWeight), 10);
  });

  it("step_completed adds the shifted index and sets the finished status", () => {
    const next = pipelineReducer(base, {
      type: PipelineActionType.PipelineUpdate,
      msg: { event: "step_completed", step: "segment", step_index: 0 },
      uploadWeight,
      idxOffset,
    });
    expect(next.completedSteps.has(2)).toBe(true);
    expect(next.statusText).toBe("Finished step: segment");
  });

  it("leaves progress/index untouched when the message omits them", () => {
    const next = pipelineReducer(base, {
      type: PipelineActionType.PipelineUpdate,
      msg: { event: "step_started", step: "x" },
      uploadWeight,
      idxOffset,
    });
    expect(next.progress).toBe(base.progress);
    expect(next.currentStepIndex).toBe(base.currentStepIndex);
  });
});

describe("pipelineReducer — terminal & marker transitions", () => {
  it("MARK_UPLOAD_STEPS_DONE marks the prefix [0..upTo]", () => {
    expect(
      pipelineReducer(initialState, { type: PipelineActionType.MarkUploadStepsDone, upTo: 0 })
        .completedSteps,
    ).toEqual(new Set([0]));
    expect(
      pipelineReducer(initialState, { type: PipelineActionType.MarkUploadStepsDone, upTo: 1 })
        .completedSteps,
    ).toEqual(new Set([0, 1]));
    expect(
      pipelineReducer(initialState, { type: PipelineActionType.MarkUploadStepsDone, upTo: 2 })
        .completedSteps,
    ).toEqual(new Set([0, 1, 2]));
  });

  it("UPLOAD_DONE_NO_PIPELINE jumps to the viewer-opening state", () => {
    const next = pipelineReducer(stateWithSteps(noMaskSteps), {
      type: PipelineActionType.UploadDoneNoPipeline,
    });
    expect(next.progress).toBe(1);
    expect(next.currentStepIndex).toBeNull();
    expect(next.statusText).toBe("Opening viewer…");
  });

  it("PIPELINE_COMPLETED_PENDING fills the bar and shows the loading message", () => {
    const next = pipelineReducer(stateWithSteps(noMaskSteps), {
      type: PipelineActionType.PipelineCompletedPending,
    });
    expect(next.progress).toBe(1);
    expect(next.statusText).toBe("Pipeline completed — loading…");
  });

  it("CONNECTION_CLOSED updates only the status line", () => {
    const next = pipelineReducer(stateWithSteps(noMaskSteps), {
      type: PipelineActionType.ConnectionClosed,
    });
    expect(next.statusText).toBe(
      "Connection closed — check your network or refresh this page.",
    );
    expect(next.steps).toEqual(noMaskSteps);
  });
});
