import { describe, it, expect } from "vitest";
import { pipelineReducer, PipelineActionType, FinishMode } from "@/app/pipeline/reducer";
import { initialState, type PipelineState } from "@/app/pipeline/types";
import { ClientStepName, PipelineStepName } from "@/api/types";

// No-mask layout: [UploadVolume, FinalizeUpload, <pipeline>] -> total 3.
const noMaskSteps = [
  ClientStepName.UploadVolume,
  ClientStepName.FinalizeUpload,
  PipelineStepName.SegmentNifti,
];

function stateWithSteps(steps: PipelineState["steps"]): PipelineState {
  return { ...initialState, steps };
}

describe("pipelineReducer - lifecycle actions", () => {
  it("BEGIN resets progress, seeds the step list, and clears connection loss", () => {
    const next = pipelineReducer(
      { ...initialState, connectionLost: true, completedSteps: new Set([0]) },
      { type: PipelineActionType.Begin, steps: noMaskSteps },
    );
    expect(next.steps).toEqual(noMaskSteps);
    expect(next.completedSteps).toEqual(new Set());
    expect(next.currentStepIndex).toBe(0);
    expect(next.progress).toBe(0);
    expect(next.statusText).toBe("Starting upload...");
    expect(next.connectionLost).toBe(false);
    expect(next.error).toBeNull();
  });

  it("SET_STEPS replaces only the step list", () => {
    const next = pipelineReducer(initialState, {
      type: PipelineActionType.SetSteps,
      steps: noMaskSteps,
    });
    expect(next.steps).toEqual(noMaskSteps);
    expect(next.progress).toBe(initialState.progress);
  });

  it("ENTER_PIPELINE seeds the bar from the step index (upload-prefix entry)", () => {
    const next = pipelineReducer(stateWithSteps(noMaskSteps), {
      type: PipelineActionType.EnterPipeline,
      stepIndex: 2,
    });
    expect(next.currentStepIndex).toBe(2);
    expect(next.progress).toBeCloseTo(2 / 3, 10);
    expect(next.statusText).toBe("Pipeline running...");
  });

  it("ENTER_PIPELINE with stepIndex 0 starts the bar at zero (reconnect entry)", () => {
    const next = pipelineReducer(stateWithSteps(noMaskSteps), {
      type: PipelineActionType.EnterPipeline,
      stepIndex: 0,
    });
    expect(next.progress).toBe(0);
    expect(next.currentStepIndex).toBe(0);
  });

  it("ENTER_PIPELINE with a null step index leaves progress at zero", () => {
    const next = pipelineReducer(stateWithSteps([]), {
      type: PipelineActionType.EnterPipeline,
      stepIndex: null,
    });
    expect(next.currentStepIndex).toBeNull();
    expect(next.progress).toBe(0);
  });
});

describe("pipelineReducer - PROGRESS (single formula)", () => {
  const base = stateWithSteps(noMaskSteps); // total 3

  it("computes progress = (stepIndex + fraction) / N", () => {
    const next = pipelineReducer(base, {
      type: PipelineActionType.Progress,
      stepIndex: 0,
      fraction: 1 / 4,
      statusText: "Uploading chunks 1 / 4",
    });
    expect(next.currentStepIndex).toBe(0);
    expect(next.progress).toBeCloseTo((0 + 1 / 4) / 3, 10);
    expect(next.statusText).toBe("Uploading chunks 1 / 4");
  });

  it("clamps the computed progress to [0, 1]", () => {
    const next = pipelineReducer(base, {
      type: PipelineActionType.Progress,
      stepIndex: 3,
      fraction: 1,
      statusText: "x",
    });
    expect(next.progress).toBe(1);
  });
});

describe("pipelineReducer - COMPLETE_STEP", () => {
  it("marks the whole prefix [0..stepIndex] for a monotonic checklist", () => {
    expect(
      pipelineReducer(initialState, {
        type: PipelineActionType.CompleteStep,
        stepIndex: 0,
      }).completedSteps,
    ).toEqual(new Set([0]));
    expect(
      pipelineReducer(initialState, {
        type: PipelineActionType.CompleteStep,
        stepIndex: 2,
      }).completedSteps,
    ).toEqual(new Set([0, 1, 2]));
  });

  it("merges with already-completed steps and keeps status when omitted", () => {
    const prev: PipelineState = {
      ...initialState,
      completedSteps: new Set([0]),
      statusText: "keep me",
    };
    const next = pipelineReducer(prev, {
      type: PipelineActionType.CompleteStep,
      stepIndex: 1,
    });
    expect(next.completedSteps).toEqual(new Set([0, 1]));
    expect(next.statusText).toBe("keep me");
  });

  it("updates the status line when provided", () => {
    const next = pipelineReducer(initialState, {
      type: PipelineActionType.CompleteStep,
      stepIndex: 0,
      statusText: "Finished step: segment",
    });
    expect(next.statusText).toBe("Finished step: segment");
  });
});

describe("pipelineReducer - FINISH", () => {
  it("noPipeline jumps to the viewer-opening state", () => {
    const next = pipelineReducer(stateWithSteps(noMaskSteps), {
      type: PipelineActionType.Finish,
      mode: FinishMode.NoPipeline,
    });
    expect(next.progress).toBe(1);
    expect(next.currentStepIndex).toBeNull();
    expect(next.statusText).toBe("Opening viewer...");
  });

  it("completed fills the bar and shows the loading message", () => {
    const next = pipelineReducer(stateWithSteps(noMaskSteps), {
      type: PipelineActionType.Finish,
      mode: FinishMode.Completed,
    });
    expect(next.progress).toBe(1);
    expect(next.statusText).toBe("Pipeline completed - loading...");
  });
});

describe("pipelineReducer - error & connection transitions", () => {
  it("SET_ERROR records the error detail", () => {
    const error = { title: "T", message: "M", hints: ["h"] };
    const next = pipelineReducer(initialState, {
      type: PipelineActionType.SetError,
      error,
    });
    expect(next.error).toEqual(error);
  });

  it("CONNECTION_CLOSED flags the loss and updates the status line", () => {
    const next = pipelineReducer(stateWithSteps(noMaskSteps), {
      type: PipelineActionType.ConnectionClosed,
    });
    expect(next.connectionLost).toBe(true);
    expect(next.statusText).toBe("Connection closed - check your network or reconnect.");
    expect(next.steps).toEqual(noMaskSteps);
  });

  it("CLEAR_CONNECTION_LOST clears only the flag", () => {
    const next = pipelineReducer(
      { ...initialState, connectionLost: true, statusText: "kept" },
      { type: PipelineActionType.ClearConnectionLost },
    );
    expect(next.connectionLost).toBe(false);
    expect(next.statusText).toBe("kept");
  });
});
