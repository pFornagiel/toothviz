"""Pure compute: DICOM upload (ZIP, single file) -> NIfTI conversion.

Runs in a subprocess via WorkerPool. Receives and returns plain strings only.
The conversion itself lives in :mod:`backend.dicom`.
"""

from __future__ import annotations

from pathlib import Path

from backend.dicom import (
    DEFAULT_MAX_VOLUME_BYTES,
    ConversionLimits,
    convert_to_nifti,
)

OUTPUT_FILENAME = "converted.nii.gz"


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
    max_volume_bytes: int = DEFAULT_MAX_VOLUME_BYTES,
) -> str:
    """Convert a DICOM input to ``<out_dir>/converted.nii.gz`` and return its path.

    Raises:
        backend.dicom.DicomConversionError: the upload cannot be converted; the
            message is meant for the user.
    """
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    final_path = out / OUTPUT_FILENAME
    final_path.unlink(missing_ok=True)

    result = convert_to_nifti(
        Path(input_path),
        final_path,
        limits=ConversionLimits(
            max_zip_members=max_zip_members,
            max_uncompressed_zip_bytes=max_uncompressed_zip_bytes,
            max_volume_bytes=max_volume_bytes,
        ),
        progress=lambda v: _emit_progress(progress_queue, v),
    )
    return str(result.path)
