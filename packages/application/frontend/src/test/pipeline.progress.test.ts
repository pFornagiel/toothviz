import { describe, it, expect } from "vitest";
import { uploadStepProgress, pipelineStepProgress } from "@/app/pipeline/progress";
import type { PipelineMessage } from "@/api/types";

describe("uploadStepProgress — dedicated finalize step (no-mask: idx 0, finalize 1)", () => {
  const layout = { stepIndex: 0, finalizeStepIndex: 1 };

  it("begin sits at the start of the upload step", () => {
    expect(uploadStepProgress({ phase: "begin" }, layout)).toEqual({
      stepIndex: 0,
      fraction: 0,
      statusText: "Starting upload…",
    });
  });

  it("uploading reports the within-step fraction from chunk progress", () => {
    expect(
      uploadStepProgress({ phase: "uploading", chunkIndex: 0, totalChunks: 4 }, layout),
    ).toEqual({
      stepIndex: 0,
      fraction: 1 / 4,
      statusText: "Uploading chunks 1 / 4",
    });
  });

  it("uploading is ignored until totalChunks is known", () => {
    expect(uploadStepProgress({ phase: "uploading", chunkIndex: 0 }, layout)).toBeNull();
  });

  it("finalizing moves to the finalize step at its midpoint", () => {
    expect(uploadStepProgress({ phase: "finalizing" }, layout)).toEqual({
      stepIndex: 1,
      fraction: 0.5,
      statusText: "Finalizing upload…",
    });
  });

  it("done fills the finalize step", () => {
    expect(uploadStepProgress({ phase: "done" }, layout)).toEqual({
      stepIndex: 1,
      fraction: 1,
      statusText: "Finalizing upload…",
    });
  });
});

describe("uploadStepProgress — shared finalize step (mask volume: idx 0, finalize null)", () => {
  const layout = { stepIndex: 0, finalizeStepIndex: null };

  it("finalizing fills the upload step (no dedicated finalize, no magic nudge)", () => {
    expect(uploadStepProgress({ phase: "finalizing" }, layout)).toEqual({
      stepIndex: 0,
      fraction: 1,
      statusText: "Finalizing upload…",
    });
  });

  it("done fills the upload step", () => {
    expect(uploadStepProgress({ phase: "done" }, layout)).toEqual({
      stepIndex: 0,
      fraction: 1,
      statusText: "Finalizing upload…",
    });
  });
});

describe("pipelineStepProgress", () => {
  it("step_started lands at the start of its step (fraction 0)", () => {
    const msg: PipelineMessage = {
      event: "step_started",
      step: "segment",
      progress: 0 / 3,
      total_steps: 3,
      step_index: 0,
    };
    expect(pipelineStepProgress(msg)).toEqual({
      stepIndex: 0,
      fraction: 0,
      statusText: "Started: segment",
      completed: false,
    });
  });

  it("step_completed fills its step (fraction 1) and flags completion", () => {
    const msg: PipelineMessage = {
      event: "step_completed",
      step: "segment",
      progress: 1 / 3,
      total_steps: 3,
      step_index: 0,
    };
    expect(pipelineStepProgress(msg)).toEqual({
      stepIndex: 0,
      fraction: 1,
      statusText: "Finished step: segment",
      completed: true,
    });
  });

  it("clamps the within-step fraction to [0, 1]", () => {
    const msg: PipelineMessage = {
      event: "step_started",
      step: "x",
      progress: 2 / 3,
      total_steps: 3,
      step_index: 0,
    };
    expect(pipelineStepProgress(msg)?.fraction).toBe(1);
  });

  it("returns null for a message without a step index", () => {
    expect(pipelineStepProgress({ event: "step_started", step: "x" })).toBeNull();
  });
});
