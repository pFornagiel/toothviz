/** Used for hints only; `accept` is omitted because Safari/macOS greys out unknown extensions. */
export const NIFTI_EXTENSIONS = [".nii", ".nii.gz"] as const;
export const DICOM_BASE_EXTENSIONS = [".zip", ".dcm"] as const;

export function isNiftiFileName(name: string): boolean {
  const name_lower_case = name.toLowerCase();
  return name_lower_case.endsWith(".nii") || name_lower_case.endsWith(".nii.gz");
}

export function isDicomBaseFile(file: File): boolean {
  const name_lower_case = file.name.toLowerCase();
  const mime = file.type.toLowerCase();
  return (
    name_lower_case.endsWith(".zip") ||
    name_lower_case.endsWith(".dcm") ||
    mime === "application/dicom" ||
    mime === "application/zip" ||
    mime === "application/x-zip-compressed"
  );
}
