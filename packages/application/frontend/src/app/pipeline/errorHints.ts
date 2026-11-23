import { PipelineStepName } from "@/api/types";

export function errorHints(failedStep?: string | null): string[] {
  const validFormat = "Ensure the file is a valid NIfTI (.nii / .nii.gz) or a ZIP of DICOM files.";
  const dicomArchive =
    "For DICOM, confirm the archive contains readable slices (not empty or corrupt).";
  const precomputedMask =
    "Try again with automated segmentation disabled and upload a precomputed mask instead.";
  const newStudy =
    "Create a new study from the home page if this message appeared after a failed run.";

  if (failedStep === "dicom_to_nifti") {
    // The error message itself names the concrete problem (incomplete ZIP,
    // missing slices, no 3D series...); these hints cover the usual fixes.
    return [
      "DICOM conversion failed - the message above says what is wrong with the upload.",
      "Export the whole CBCT volume from the scanner software: a ZIP of the DICOM folder or a single multi-frame DICOM file.",
      "If the ZIP was downloaded or copied, let the transfer finish completely, then upload it again.",
      newStudy,
    ];
  }
  if (failedStep === PipelineStepName.SegmentNifti) {
    return [
      "Segmentation failed - the volume may be unsupported or too small for the model.",
      precomputedMask,
      newStudy,
    ];
  }
  return [validFormat, dicomArchive, precomputedMask, newStudy];
}
