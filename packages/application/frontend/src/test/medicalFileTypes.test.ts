import { describe, it, expect } from "vitest";
import { isDicomBaseFile, validateDicomBaseFile } from "@/app/utils/medicalFileTypes";

const file = (name: string, type = "") => new File(["x"], name, { type });

describe("isDicomBaseFile", () => {
  it.each([
    "scan.zip",
    "SCAN.ZIP",
    "slice.dcm",
    "volume.dicom",
    "IMG0001.IMA",
    "IM000001",
    "DICOMDIR",
  ])("accepts %s", (name) => {
    expect(isDicomBaseFile(file(name))).toBe(true);
  });

  it.each(["scan.nii.gz", "scan.nii", "photo.jpg", "report.pdf"])("rejects %s", (name) => {
    expect(isDicomBaseFile(file(name))).toBe(false);
  });

  it("accepts by MIME type when the name is unhelpful", () => {
    expect(isDicomBaseFile(file("export.bin", "application/dicom"))).toBe(true);
  });

  it("explains what to pick", () => {
    expect(validateDicomBaseFile(file("scan.nii.gz"))).toContain("DICOM folder");
    expect(validateDicomBaseFile(file("scan.zip"))).toBeNull();
  });
});
