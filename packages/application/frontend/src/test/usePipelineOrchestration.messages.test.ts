import { describe, it, expect } from "vitest";
import { errorHints } from "@/app/hooks/usePipelineOrchestration";
import { PipelineStepName } from "@/api/types";

describe("errorHints", () => {
  it("returns DICOM-specific guidance for dicom_to_nifti", () => {
    const hints = errorHints("dicom_to_nifti");
    expect(hints[0]).toContain("DICOM conversion failed");
    expect(hints).toHaveLength(4);
  });

  it("returns segmentation-specific guidance for SegmentNifti", () => {
    const hints = errorHints(PipelineStepName.SegmentNifti);
    expect(hints[0]).toContain("Segmentation failed");
    expect(hints).toHaveLength(3);
  });

  it("falls back to the generic format hint for null/unknown steps", () => {
    const generic = errorHints(null);
    expect(generic[0]).toContain("valid NIfTI");
    expect(generic).toHaveLength(4);
    expect(errorHints("something_else")).toEqual(generic);
    expect(errorHints()).toEqual(generic);
  });
});
