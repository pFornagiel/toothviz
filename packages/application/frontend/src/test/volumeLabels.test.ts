import { describe, it, expect } from "vitest";
import {
  SCAN_LABEL,
  SEGMENTATION_LABEL,
  volumeLabel,
} from "@/app/visualization/volumeLabels";

describe("volumeLabel", () => {
  it("names the scan and the segmentation instead of their files", () => {
    expect(volumeLabel(0, 1, "ToothFairy3F_001_cropped_0000.nii.gz")).toBe(SCAN_LABEL);
    expect(volumeLabel(1, 1, "segmentation_mask.nii.gz")).toBe(SEGMENTATION_LABEL);
  });

  it("names the scan when no segmentation is loaded", () => {
    expect(volumeLabel(0, -1, "scan.nii.gz")).toBe(SCAN_LABEL);
  });

  it("falls back to the file name for any other volume", () => {
    expect(volumeLabel(2, 1, "extra.nii.gz")).toBe("extra.nii.gz");
    expect(volumeLabel(2, 1, undefined)).toBe("Volume 2");
  });
});
