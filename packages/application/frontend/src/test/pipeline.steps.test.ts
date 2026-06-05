import { describe, it, expect } from "vitest";
import { createLoadingSteps } from "@/app/pipeline/steps";
import type { UploadPayload } from "@/app/pipeline";
import {
  ClientStepName,
  PipelineStepName,
  UploadKind,
} from "@/api/types";

function makePayload(overrides: Partial<UploadPayload> = {}): UploadPayload {
  return {
    baseImageFile: new File(["x"], "volume.nii"),
    baseKind: UploadKind.NiftiRaw,
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

  it("inserts the mask upload step when a segmentation file is present", () => {
    const steps = createLoadingSteps(
      makePayload({ segmentationFile: new File(["m"], "mask.nii") }),
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
