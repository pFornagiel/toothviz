import { describe, it, expect, vi } from "vitest";
import { applyWsMessage } from "@/app/pipeline/wsMessage";
import { PipelineActionType, FinishMode } from "@/app/pipeline/reducer";
import type { PipelineMessage } from "@/api/types";

function makeOptions(overrides: Partial<Parameters<typeof applyWsMessage>[1]> = {}) {
  return {
    stepOffset: 2,
    dispatch: vi.fn(),
    getPipelineFinished: vi.fn(() => false),
    markPipelineFinished: vi.fn(),
    disconnect: vi.fn(),
    onPipelineCompleted: vi.fn(),
    onPipelineFailed: vi.fn(),
    onPipelineCancelled: vi.fn(),
    ...overrides,
  };
}

describe("applyWsMessage — non-terminal events", () => {
  it("globalises step_started into a single PROGRESS dispatch", () => {
    const opts = makeOptions();
    applyWsMessage(
      { event: "step_started", step: "segment", progress: 0, total_steps: 3, step_index: 0 },
      opts,
    );

    expect(opts.dispatch).toHaveBeenCalledTimes(1);
    expect(opts.dispatch).toHaveBeenCalledWith({
      type: PipelineActionType.Progress,
      stepIndex: 0 + opts.stepOffset,
      fraction: 0,
      statusText: "Started: segment",
    });
    expect(opts.markPipelineFinished).not.toHaveBeenCalled();
    expect(opts.disconnect).not.toHaveBeenCalled();
  });

  it("emits PROGRESS then COMPLETE_STEP (both globalised) for step_completed", () => {
    const opts = makeOptions();
    applyWsMessage(
      { event: "step_completed", step: "segment", progress: 1 / 3, total_steps: 3, step_index: 0 },
      opts,
    );

    expect(opts.dispatch).toHaveBeenCalledTimes(2);
    expect(opts.dispatch).toHaveBeenNthCalledWith(1, {
      type: PipelineActionType.Progress,
      stepIndex: 2,
      fraction: 1,
      statusText: "Finished step: segment",
    });
    expect(opts.dispatch).toHaveBeenNthCalledWith(2, {
      type: PipelineActionType.CompleteStep,
      stepIndex: 2,
    });
  });

  it("ignores a non-terminal message with no step index", () => {
    const opts = makeOptions();
    applyWsMessage({ event: "step_started", step: "x" }, opts);
    expect(opts.dispatch).not.toHaveBeenCalled();
  });
});

describe("applyWsMessage — terminal events", () => {
  it("pipeline_completed: marks finished, disconnects, dispatches FINISH(completed), calls onCompleted once", () => {
    const opts = makeOptions();
    applyWsMessage({ event: "pipeline_completed" }, opts);

    expect(opts.markPipelineFinished).toHaveBeenCalledTimes(1);
    expect(opts.disconnect).toHaveBeenCalledTimes(1);
    expect(opts.dispatch).toHaveBeenCalledTimes(1);
    expect(opts.dispatch).toHaveBeenCalledWith({
      type: PipelineActionType.Finish,
      mode: FinishMode.Completed,
    });
    expect(opts.onPipelineCompleted).toHaveBeenCalledTimes(1);
    expect(opts.onPipelineFailed).not.toHaveBeenCalled();
    expect(opts.onPipelineCancelled).not.toHaveBeenCalled();
  });

  it("pipeline_failed: forwards the message to onPipelineFailed once", () => {
    const opts = makeOptions();
    const msg: PipelineMessage = {
      event: "pipeline_failed",
      error: "boom",
      failed_step: "dicom_to_nifti",
    };
    applyWsMessage(msg, opts);

    expect(opts.markPipelineFinished).toHaveBeenCalledTimes(1);
    expect(opts.disconnect).toHaveBeenCalledTimes(1);
    expect(opts.onPipelineFailed).toHaveBeenCalledTimes(1);
    expect(opts.onPipelineFailed).toHaveBeenCalledWith(msg);
    expect(opts.onPipelineCompleted).not.toHaveBeenCalled();
  });

  it("pipeline_cancelled: calls onPipelineCancelled once", () => {
    const opts = makeOptions();
    applyWsMessage({ event: "pipeline_cancelled" }, opts);

    expect(opts.markPipelineFinished).toHaveBeenCalledTimes(1);
    expect(opts.disconnect).toHaveBeenCalledTimes(1);
    expect(opts.onPipelineCancelled).toHaveBeenCalledTimes(1);
  });

  it("ignores terminal events once the pipeline is already finished", () => {
    const opts = makeOptions({ getPipelineFinished: vi.fn(() => true) });
    applyWsMessage({ event: "pipeline_completed" }, opts);
    applyWsMessage({ event: "pipeline_failed" }, opts);
    applyWsMessage({ event: "pipeline_cancelled" }, opts);

    expect(opts.markPipelineFinished).not.toHaveBeenCalled();
    expect(opts.disconnect).not.toHaveBeenCalled();
    expect(opts.dispatch).not.toHaveBeenCalled();
    expect(opts.onPipelineCompleted).not.toHaveBeenCalled();
    expect(opts.onPipelineFailed).not.toHaveBeenCalled();
    expect(opts.onPipelineCancelled).not.toHaveBeenCalled();
  });
});
