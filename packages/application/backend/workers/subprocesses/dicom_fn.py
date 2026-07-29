"""Pure compute: DICOM (ZIP or single .dcm) -> NIfTI conversion.

Runs in a subprocess via WorkerPool. Receives and returns plain strings only.
"""

from __future__ import annotations

import math
import shutil
from pathlib import Path

import dicom2nifti
import nibabel as nib

from backend.utils.dicom_zip import populate_dir_from_zip_or_file


def _collect_nifti_candidates(directory: Path) -> list[Path]:
    gz = sorted(directory.rglob("*.nii.gz"))
    plain = sorted(directory.rglob("*.nii"))
    return gz + plain


def _spatial_voxel_count(nifti_path: Path) -> int:
    """Approximate 3D volume size for choosing among multi-series exports."""
    img = nib.load(str(nifti_path))
    shape = tuple(img.shape)
    if len(shape) >= 3:
        return int(math.prod(shape[:3]))
    return int(math.prod(shape)) if shape else 0


def _select_primary_nifti(candidates: list[Path]) -> Path:
    """Pick one NIfTI when dicom2nifti wrote several (e.g. raw + reconstruction)."""
    if len(candidates) == 1:
        return candidates[0]
    scored = [(p, _spatial_voxel_count(p)) for p in candidates]
    scored.sort(key=lambda t: (-t[1], t[0].name))
    return scored[0][0]


def _emit_progress(progress_queue, value: float) -> None:
    if progress_queue is None:
        return
    try:
        progress_queue.put(float(value))
    except Exception:
        pass


def convert_dicom(
    input_path: str,
    out_dir: str,
    max_zip_members: int,
    max_uncompressed_zip_bytes: int,
    progress_queue=None,
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
    _emit_progress(progress_queue, 0.25)

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
    _emit_progress(progress_queue, 0.75)

    candidates = _collect_nifti_candidates(nifti_dir)
    if not candidates:
        raise RuntimeError(
            "DICOM conversion produced no NIfTI volume. "
            "dicom2nifti skips series that cannot be stacked (e.g. fewer than three "
            "slices, scout/localizer only, or invalid slice geometry). "
            "Use a full volumetric series (CT/CBCT with many slices), not a single slice "
            "or planning image only."
        )
    primary = _select_primary_nifti(candidates)

    final_path = out / "converted.nii.gz"
    img = nib.load(str(primary))
    nib.save(img, str(final_path))

    # Validate (catch corrupted writer output early)
    _ = nib.load(str(final_path))
    _emit_progress(progress_queue, 1.0)
    return str(final_path)
