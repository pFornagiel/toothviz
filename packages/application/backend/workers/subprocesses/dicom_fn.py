"""Pure compute: DICOM (ZIP or single .dcm) → NIfTI conversion.

Runs in a subprocess via WorkerPool. Receives and returns plain strings only.
"""

from __future__ import annotations

import shutil
from pathlib import Path

import dicom2nifti
import nibabel as nib

from backend.utils.dicom_zip import populate_dir_from_zip_or_file


def _collect_nifti_candidates(directory: Path) -> list[Path]:
    gz = sorted(directory.rglob("*.nii.gz"))
    plain = sorted(directory.rglob("*.nii"))
    return gz + plain


def convert_dicom(
    input_path: str,
    out_dir: str,
    max_zip_members: int,
    max_uncompressed_zip_bytes: int,
) -> str:
    """Convert a DICOM input to a NIfTI file.

    Accepts either a ZIP archive containing DICOM files or a single DICOM file.
    Returns the path (str) of ``converted.nii.gz`` under ``out_dir``.
    """
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)

    dicom_dir = out / "dicom_extracted"
    if dicom_dir.exists():
        shutil.rmtree(dicom_dir)
    dicom_dir.mkdir(parents=True, exist_ok=True)

    src_input = Path(input_path)
    populate_dir_from_zip_or_file(
        src_input,
        dicom_dir,
        max_members=max_zip_members,
        max_uncompressed_bytes=max_uncompressed_zip_bytes,
    )

    nifti_dir = out / "nifti_from_dicom"
    if nifti_dir.exists():
        shutil.rmtree(nifti_dir)
    nifti_dir.mkdir(parents=True, exist_ok=True)

    try:
        dicom2nifti.convert_directory(
            str(dicom_dir),
            str(nifti_dir),
            compression=True,
            reorient=True,
        )
    except Exception as exc:
        raise RuntimeError(
            "DICOM to NIfTI conversion failed (no valid series or missing DICOM files?)"
        ) from exc

    candidates = _collect_nifti_candidates(nifti_dir)
    if not candidates:
        raise RuntimeError(
            "DICOM conversion produced no NIfTI files (check the archive contents)"
        )
    if len(candidates) > 1:
        names = [p.name for p in candidates]
        raise RuntimeError(
            "Ambiguous DICOM conversion: expected one NIfTI volume, "
            f"got {len(candidates)}: {names[:10]}" + ("..." if len(names) > 10 else "")
        )

    final_path = out / "converted.nii.gz"
    img = nib.load(str(candidates[0]))
    nib.save(img, str(final_path))

    # Validate (catch corrupted writer output early)
    _ = nib.load(str(final_path))
    return str(final_path)
