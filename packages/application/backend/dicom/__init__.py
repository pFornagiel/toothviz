"""DICOM upload -> NIfTI volume conversion.

Stages, each in its own module:

* ``sources`` - list candidate files in a ZIP / file / directory (no extraction)
* ``series``  - read headers, pick the volume series, compute slice geometry
* ``volume``  - decode pixels into one array and write NIfTI

``convert_to_nifti`` runs them in order. Every user-facing failure is a
``DicomConversionError`` whose message explains what is wrong with the upload.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

from backend.dicom.errors import DicomConversionError
from backend.dicom.series import build_geometry, scan_headers, select_volume_series
from backend.dicom.sources import (
    DEFAULT_MAX_UNCOMPRESSED_ZIP_BYTES,
    DEFAULT_MAX_ZIP_MEMBERS,
    open_dicom_sources,
)
from backend.dicom.volume import DEFAULT_MAX_VOLUME_BYTES, assemble_volume, write_nifti

logger = logging.getLogger(__name__)

__all__ = [
    "DEFAULT_MAX_UNCOMPRESSED_ZIP_BYTES",
    "DEFAULT_MAX_VOLUME_BYTES",
    "DEFAULT_MAX_ZIP_MEMBERS",
    "ConversionLimits",
    "ConversionResult",
    "DicomConversionError",
    "convert_to_nifti",
]

# Share of the step's progress bar given to each stage.
_SCAN_SHARE = 0.15
_DECODE_SHARE = 0.65


@dataclass(frozen=True)
class ConversionLimits:
    max_zip_members: int = DEFAULT_MAX_ZIP_MEMBERS
    max_uncompressed_zip_bytes: int = DEFAULT_MAX_UNCOMPRESSED_ZIP_BYTES
    max_volume_bytes: int = DEFAULT_MAX_VOLUME_BYTES


@dataclass
class ConversionResult:
    path: Path
    shape: tuple[int, int, int]
    voxel_size_mm: tuple[float, float, float]
    dtype: str
    warnings: list[str] = field(default_factory=list)


def convert_to_nifti(
    input_path: Path,
    output_path: Path,
    *,
    limits: ConversionLimits = ConversionLimits(),
    progress: Callable[[float], None] | None = None,
) -> ConversionResult:
    """Convert the largest 3D series in a DICOM upload to one NIfTI file."""

    def report(start: float, share: float) -> Callable[[float], None]:
        def cb(fraction: float) -> None:
            if progress is not None:
                progress(start + share * max(0.0, min(1.0, fraction)))
        return cb

    with open_dicom_sources(
        input_path,
        max_members=limits.max_zip_members,
        max_uncompressed_bytes=limits.max_uncompressed_zip_bytes,
    ) as listing:
        summary = scan_headers(listing.sources, progress=report(0.0, _SCAN_SHARE))
        summary.not_dicom += listing.skipped_by_name
        logger.info(
            "DICOM scan: %d candidate files, %d images, %d skipped as OS metadata, "
            "%d not DICOM, %d without pixels, %d unreadable, %d truncated",
            len(listing.sources), len(summary.headers), listing.skipped_metadata,
            summary.not_dicom, summary.non_image, summary.unreadable,
            len(summary.truncated),
        )
        members = select_volume_series(summary)
        geometry = build_geometry(members)
        volume = assemble_volume(
            geometry,
            max_volume_bytes=limits.max_volume_bytes,
            progress=report(_SCAN_SHARE, _DECODE_SHARE),
        )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    write_nifti(volume, geometry.affine, output_path)
    report(0.0, 1.0)(1.0)

    zooms = tuple(float(z) for z in (abs(geometry.affine[:3, :3]) ** 2).sum(axis=0) ** 0.5)
    result = ConversionResult(
        path=output_path,
        shape=volume.shape,
        voxel_size_mm=zooms,
        dtype=str(volume.dtype),
        warnings=list(geometry.warnings),
    )
    logger.info(
        "DICOM converted: shape=%s voxel=%s mm dtype=%s",
        result.shape, tuple(round(z, 4) for z in zooms), result.dtype,
    )
    return result
