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
    return [
      "DICOM conversion failed - check that the ZIP is not corrupt and contains valid DICOM.",
      dicomArchive,
      precomputedMask,
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

export const CANCELLED_HINTS = ["Open another study or start again from the home page."];
