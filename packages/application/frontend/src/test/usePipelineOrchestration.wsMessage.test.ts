import { describe, it, expect, vi } from "vitest";
import {
  applyWsMessage,
  PipelineActionType,
} from "@/app/hooks/usePipelineOrchestration";
import type { PipelineMessage } from "@/api/types";

function makeOptions(overrides: Partial<Parameters<typeof applyWsMessage>[1]> = {}) {
  return {
    uploadWeight: 2 / 3,
    idxOffset: 2,
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
  it("emits a single PIPELINE_UPDATE dispatch for a step event", () => {
    const opts = makeOptions();
    const msg: PipelineMessage = {
      event: "step_started",
      step: "segment",
      progress: 0.5,
      step_index: 0,
    };

    applyWsMessage(msg, opts);

    expect(opts.dispatch).toHaveBeenCalledTimes(1);
    expect(opts.dispatch).toHaveBeenCalledWith({
      type: PipelineActionType.PipelineUpdate,
      msg,
      uploadWeight: opts.uploadWeight,
      idxOffset: opts.idxOffset,
    });
    expect(opts.markPipelineFinished).not.toHaveBeenCalled();
    expect(opts.disconnect).not.toHaveBeenCalled();
    expect(opts.onPipelineCompleted).not.toHaveBeenCalled();
    expect(opts.onPipelineFailed).not.toHaveBeenCalled();
    expect(opts.onPipelineCancelled).not.toHaveBeenCalled();
  });
});

describe("applyWsMessage — terminal events", () => {
  it("pipeline_completed: marks finished, disconnects, dispatches pending, calls onCompleted once", () => {
    const opts = makeOptions();
    applyWsMessage({ event: "pipeline_completed" }, opts);

    expect(opts.markPipelineFinished).toHaveBeenCalledTimes(1);
    expect(opts.disconnect).toHaveBeenCalledTimes(1);
    expect(opts.dispatch).toHaveBeenCalledTimes(1);
    expect(opts.dispatch).toHaveBeenCalledWith({
      type: PipelineActionType.PipelineCompletedPending,
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
