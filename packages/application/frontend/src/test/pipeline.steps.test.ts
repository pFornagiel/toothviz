import { describe, it, expect } from "vitest";
import { createLoadingSteps } from "@/app/pipeline/steps";
import type { UploadJob, UploadPayload } from "@/app/pipeline";
import {
  ClientStepName,
  PipelineStepName,
  UploadKind,
} from "@/api/types";

function volumeJob(): UploadJob {
  return {
    file: new File(["x"], "volume.nii"),
    kind: UploadKind.NiftiRaw,
    stepId: ClientStepName.UploadVolume,
    carriesPipelines: true,
  };
}

function maskJob(): UploadJob {
  return {
    file: new File(["m"], "mask.nii"),
    kind: UploadKind.NiftiMask,
    stepId: ClientStepName.UploadMask,
    carriesPipelines: false,
  };
}

function makePayload(overrides: Partial<UploadPayload> = {}): UploadPayload {
  return {
    uploads: [volumeJob()],
    pipelines: [{ name: PipelineStepName.SegmentNifti }],
    ...overrides,
  };
}

describe("createLoadingSteps", () => {
  it("builds the no-mask layout (volume, finalize, pipelines)", () => {
    const steps = createLoadingSteps(makePayload());
    expect(steps).toEqual([
      ClientStepName.UploadVolume,
      ClientStepName.FinalizeUpload,
      PipelineStepName.SegmentNifti,
    ]);
  });

  it("inserts the mask upload step when a mask upload is present", () => {
    const steps = createLoadingSteps(
      makePayload({ uploads: [volumeJob(), maskJob()] }),
    );
    expect(steps).toEqual([
      ClientStepName.UploadVolume,
      ClientStepName.UploadMask,
      ClientStepName.FinalizeUpload,
      PipelineStepName.SegmentNifti,
    ]);
  });

  it("appends every requested pipeline in order", () => {
    const steps = createLoadingSteps(
      makePayload({
        pipelines: [
          { name: PipelineStepName.SegmentNifti },
          { name: PipelineStepName.Stub },
        ],
      }),
    );
    expect(steps).toEqual([
      ClientStepName.UploadVolume,
      ClientStepName.FinalizeUpload,
      PipelineStepName.SegmentNifti,
      PipelineStepName.Stub,
    ]);
  });
});
