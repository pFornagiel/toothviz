import { describe, it, expect } from "vitest";
import { STUDY_MODES, SegmentationType, MaskInput, buildUploadPayload } from "@/app/pipeline";
import { ClientStepName, PipelineStepName, UploadKind } from "@/api/types";

const volume = { file: new File(["v"], "volume.nii"), kind: UploadKind.NiftiRaw };
const mask = new File(["m"], "mask.nii");

describe("buildUploadPayload", () => {
  it("builds a single volume upload that carries the pipelines (None)", () => {
    const payload = buildUploadPayload(volume, STUDY_MODES[SegmentationType.None]);
    expect(payload.uploads).toEqual([
      {
        file: volume.file,
        kind: UploadKind.NiftiRaw,
        stepId: ClientStepName.UploadVolume,
        carriesPipelines: true,
      },
    ]);
    expect(payload.pipelines).toEqual([]);
  });

  it("appends a trailing mask upload for a precomputed mask mode", () => {
    const payload = buildUploadPayload(volume, STUDY_MODES[SegmentationType.Precomputed], mask);
    expect(payload.uploads).toHaveLength(2);
    expect(payload.uploads[1]).toEqual({
      file: mask,
      kind: UploadKind.NiftiMask,
      stepId: ClientStepName.UploadMask,
      carriesPipelines: false,
    });
    // Exactly one job carries the pipelines.
    expect(payload.uploads.filter((u) => u.carriesPipelines)).toHaveLength(1);
    expect(payload.uploads[0].carriesPipelines).toBe(true);
  });

  it("ignores a mask file for a mode that does not collect one", () => {
    const payload = buildUploadPayload(volume, STUDY_MODES[SegmentationType.Automated], mask);
    expect(payload.uploads).toHaveLength(1);
    expect(payload.pipelines).toEqual([{ name: PipelineStepName.SegmentNifti }]);
  });

  it("carries the automated mode's segment pipeline", () => {
    const payload = buildUploadPayload(volume, STUDY_MODES[SegmentationType.Automated]);
    expect(payload.pipelines).toEqual([{ name: PipelineStepName.SegmentNifti }]);
  });

  it("carries the testing-stub mode's stubx3 + passthrough pipeline", () => {
    const payload = buildUploadPayload(volume, STUDY_MODES[SegmentationType.TestingStub]);
    expect(payload.pipelines).toEqual([
      { name: PipelineStepName.Stub },
      { name: PipelineStepName.Stub },
      { name: PipelineStepName.Stub },
      { name: PipelineStepName.Passthrough },
    ]);
  });
});

describe("STUDY_MODES registry", () => {
  it("keys each mode by its own SegmentationType", () => {
    for (const key of Object.values(SegmentationType)) {
      expect(STUDY_MODES[key].key).toBe(key);
    }
  });

  it("only the precomputed mode requires a mask file", () => {
    const required = Object.values(STUDY_MODES).filter((m) => m.maskInput === MaskInput.Required);
    expect(required.map((m) => m.key)).toEqual([SegmentationType.Precomputed]);
    expect(STUDY_MODES[SegmentationType.Precomputed].validateMask).toBeTypeOf("function");
  });

  it("always registers the production modes", () => {
    for (const key of [
      SegmentationType.None,
      SegmentationType.Precomputed,
      SegmentationType.Automated,
    ]) {
      expect(STUDY_MODES[key]).toBeDefined();
    }
  });

  it("includes the dev-only testing stub under a dev build", () => {
    // Vitest runs with `import.meta.env.DEV === true`, so the dev-gated mode is
    // present here; it is spread out of production builds.
    expect(STUDY_MODES[SegmentationType.TestingStub]).toBeDefined();
  });
});
