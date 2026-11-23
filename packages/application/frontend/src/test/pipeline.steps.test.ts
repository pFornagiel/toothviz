import { describe, it, expect } from "vitest";
import {
  createLoadingSteps,
  createUploadPrefixSteps,
  expectedServerSteps,
} from "@/app/pipeline/steps";
import type { UploadJob, UploadPayload } from "@/app/pipeline";
import {
  BackendStepName,
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
 
function dicomJob(): UploadJob {
  return {
    file: new File(["x"], "scan.zip"),
    kind: UploadKind.DicomZip,
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
 
describe("createUploadPrefixSteps", () => {
  it("lists upload steps then finalize", () => {
    expect(createUploadPrefixSteps(makePayload())).toEqual([
      ClientStepName.UploadVolume,
      ClientStepName.FinalizeUpload,
    ]);
  });
 
  it("includes the mask upload when present", () => {
    expect(
      createUploadPrefixSteps(makePayload({ uploads: [volumeJob(), maskJob()] })),
    ).toEqual([
      ClientStepName.UploadVolume,
      ClientStepName.UploadMask,
      ClientStepName.FinalizeUpload,
    ]);
  });
});
 
describe("expectedServerSteps", () => {
  it("returns only requested pipelines for NIfTI", () => {
    expect(expectedServerSteps(makePayload())).toEqual([PipelineStepName.SegmentNifti]);
  });
 
  it("prepends dicom_to_nifti before pipelines for DICOM", () => {
    expect(
      expectedServerSteps(
        makePayload({
          uploads: [dicomJob()],
          pipelines: [{ name: PipelineStepName.SegmentNifti }],
        }),
      ),
    ).toEqual([BackendStepName.DicomToNifti, PipelineStepName.SegmentNifti]);
  });
 
  it("returns only dicom_to_nifti when DICOM has no user pipelines", () => {
    expect(
      expectedServerSteps(makePayload({ uploads: [dicomJob()], pipelines: [] })),
    ).toEqual([BackendStepName.DicomToNifti]);
  });
});
 
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
    const steps = createLoadingSteps(makePayload({ uploads: [volumeJob(), maskJob()] }));
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
        pipelines: [{ name: PipelineStepName.SegmentNifti }, { name: PipelineStepName.Stub }],
      }),
    );
    expect(steps).toEqual([
      ClientStepName.UploadVolume,
      ClientStepName.FinalizeUpload,
      PipelineStepName.SegmentNifti,
      PipelineStepName.Stub,
    ]);
  });
 
  it("inserts dicom_to_nifti before pipelines for DICOM uploads", () => {
    const steps = createLoadingSteps(
      makePayload({
        uploads: [dicomJob()],
        pipelines: [{ name: PipelineStepName.SegmentNifti }],
      }),
    );
    expect(steps).toEqual([
      ClientStepName.UploadVolume,
      ClientStepName.FinalizeUpload,
      BackendStepName.DicomToNifti,
      PipelineStepName.SegmentNifti,
    ]);
  });
 
  it("still shows dicom_to_nifti when DICOM has no user pipelines", () => {
    const steps = createLoadingSteps(
      makePayload({
        uploads: [dicomJob()],
        pipelines: [],
      }),
    );
    expect(steps).toEqual([
      ClientStepName.UploadVolume,
      ClientStepName.FinalizeUpload,
      BackendStepName.DicomToNifti,
    ]);
  });
});