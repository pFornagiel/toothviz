/** Used for hints only; `accept` is omitted because Safari/macOS greys out unknown extensions. */
export const NIFTI_EXTENSIONS = [".nii", ".nii.gz"] as const;
export const DICOM_BASE_EXTENSIONS = [".zip", ".dcm", ".dicom", ".ima"] as const;

export function isNiftiFileName(name: string): boolean {
  const name_lower_case = name.toLowerCase();
  return name_lower_case.endsWith(".nii") || name_lower_case.endsWith(".nii.gz");
}

/** True for names like `IM000001` or `DICOMDIR` - scanners often write DICOM without an extension. */
function hasNoExtension(name: string): boolean {
  const base = name.split(/[\\/]/).pop() ?? name;
  return !base.includes(".");
}

/**
 * Accepts what the backend can read: a ZIP of a DICOM folder or a single DICOM file
 * (a multi-frame volume). The backend checks the content itself, so this only keeps
 * obviously wrong picks (NIfTI, images, documents) out.
 */
export function isDicomBaseFile(file: File): boolean {
  const name_lower_case = file.name.toLowerCase();
  const mime = file.type.toLowerCase();
  return (
    DICOM_BASE_EXTENSIONS.some((ext) => name_lower_case.endsWith(ext)) ||
    hasNoExtension(file.name) ||
    mime === "application/dicom" ||
    mime === "application/zip"
  );
}

export function validateNiftiFile(file: File | null): string | null {
  if (!file) {
    return null;
  }
  if (!isNiftiFileName(file.name)) {
    return `Choose a NIfTI file (${NIFTI_EXTENSIONS.join(" or ")}).`;
  }
  return null;
}

export function validateDicomBaseFile(file: File | null): string | null {
  if (!file) {
    return null;
  }
  if (!isDicomBaseFile(file)) {
    return "Choose a ZIP of the scan's DICOM folder or a single DICOM file.";
  }
  return null;
}
