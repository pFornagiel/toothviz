"""Pure compute: DICOM (ZIP or single .dcm) → NIfTI conversion.

Runs in a subprocess via WorkerPool. Receives and returns plain strings only.
"""

from __future__ import annotations

import shutil
import zipfile
from pathlib import Path

import dicom2nifti
import nibabel as nib


def _safe_extract_zip(
    zip_path: Path,
    dest_dir: Path,
    *,
    max_members: int,
    max_uncompressed_bytes: int,
) -> None:
    dest_dir = dest_dir.resolve()
    dest_dir.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(zip_path) as zf:
        infos = zf.infolist()
        if len(infos) > max_members:
            raise ValueError(
                f"ZIP contains too many members ({len(infos)} > {max_members})"
            )
        total_uncompressed = sum(i.file_size for i in infos if not i.is_dir())
        if total_uncompressed > max_uncompressed_bytes:
            raise ValueError(
                "ZIP uncompressed size exceeds configured limit "
                f"({total_uncompressed} > {max_uncompressed_bytes})"
            )

        for info in infos:
            if info.is_dir() or info.filename.endswith("/"):
                continue
            member_path = Path(info.filename)
            if member_path.is_absolute():
                raise ValueError(f"unsafe ZIP member path: {info.filename!r}")
            target = (dest_dir / member_path).resolve()
            try:
                target.relative_to(dest_dir)
            except ValueError:
                raise ValueError(
                    f"ZIP path escapes destination: {info.filename!r}"
                ) from None

        for info in infos:
            if info.is_dir() or info.filename.endswith("/"):
                continue
            target = (dest_dir / Path(info.filename)).resolve()
            target.parent.mkdir(parents=True, exist_ok=True)
            with zf.open(info, "r") as src, open(target, "wb") as dst:
                shutil.copyfileobj(src, dst, length=1024 * 1024)


def _collect_nifti_candidates(directory: Path) -> list[Path]:
    gz = sorted(directory.rglob("*.nii.gz"))
    plain = sorted(p for p in directory.rglob("*.nii") if p.suffix == ".nii")
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
    if not src_input.is_file():
        raise FileNotFoundError(f"DICOM input not found: {input_path}")

    if zipfile.is_zipfile(input_path):
        _safe_extract_zip(
            src_input,
            dicom_dir,
            max_members=max_zip_members,
            max_uncompressed_bytes=max_uncompressed_zip_bytes,
        )
    else:
        shutil.copy2(src_input, dicom_dir / src_input.name)

    nifti_stage = out / "nifti_from_dicom"
    if nifti_stage.exists():
        shutil.rmtree(nifti_stage)
    nifti_stage.mkdir(parents=True, exist_ok=True)

    try:
        dicom2nifti.convert_directory(
            str(dicom_dir),
            str(nifti_stage),
            compression=True,
            reorient=True,
        )
    except Exception as exc:
        raise RuntimeError(
            "DICOM to NIfTI conversion failed "
            "(no valid series or missing DICOM files?)"
        ) from exc

    candidates = _collect_nifti_candidates(nifti_stage)
    if len(candidates) == 0:
        raise RuntimeError(
            "DICOM conversion produced no NIfTI files (check the archive contents)"
        )
    if len(candidates) > 1:
        names = [p.name for p in candidates]
        raise RuntimeError(
            "Ambiguous DICOM conversion: expected one NIfTI volume, "
            f"got {len(candidates)}: {names[:10]}"
            + ("..." if len(names) > 10 else "")
        )

    final_path = out / "converted.nii.gz"
    img = nib.load(str(candidates[0]))
    nib.save(img, str(final_path))

    # Validate round-trip (catch corrupted writer output early)
    _ = nib.load(str(final_path))
    return str(final_path)
