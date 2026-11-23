"""Decode the pixels of a selected series into one array and write it as NIfTI.

Memory use is one output volume plus one decoded file at a time: every file is
decoded once and copied straight into a preallocated array, instead of keeping
all slices around and stacking them at the end (which needs twice the memory).
"""

from __future__ import annotations

import logging
import warnings
from collections.abc import Callable
from pathlib import Path

import nibabel as nib
import numpy as np
import pydicom
from pydicom.uid import UID

from backend.dicom.errors import DicomConversionError
from backend.dicom.series import ImageHeader, VolumeGeometry

logger = logging.getLogger(__name__)

# Upper bound for the decoded volume. Protects against bogus headers and
# compressed "bombs"; a 1000x1000x1000 int16 CBCT is ~2 GB.
DEFAULT_MAX_VOLUME_BYTES = 8 * 1024**3

# Matches what dicom2nifti (the previous converter) wrote, so studies converted
# before and after the rewrite have the same voxel order.
OUTPUT_AXCODES = ("L", "A", "S")


def _is_integral(x: float) -> bool:
    return float(x).is_integer()


class _VolumeBuffer:
    """Output array that starts compact (int16) and widens only if values need it."""

    def __init__(self, shape: tuple[int, int, int], dtype: np.dtype, max_bytes: int) -> None:
        self._max_bytes = max_bytes
        self._check_size(shape, dtype)
        # Fortran order: data[:, :, k] is contiguous, so each slice is one copy,
        # and nibabel writes NIfTI (column-major) without reordering.
        self.data = np.empty(shape, dtype=dtype, order="F")

    def _check_size(self, shape, dtype) -> None:
        need = int(np.prod(shape, dtype=np.int64)) * np.dtype(dtype).itemsize
        if need > self._max_bytes:
            raise DicomConversionError(
                f"The volume is too large to process: {shape[0]}x{shape[1]}x{shape[2]} "
                f"voxels need {need / 1024**3:.1f} GB, above the "
                f"{self._max_bytes / 1024**3:.1f} GB limit."
            )

    def _widen(self, dtype) -> None:
        logger.info("Widening volume from %s to %s", self.data.dtype, np.dtype(dtype))
        self._check_size(self.data.shape, dtype)
        self.data = self.data.astype(dtype, order="F")

    def put(self, k: int, pixels: np.ndarray) -> None:
        target = self.data.dtype
        if not np.can_cast(pixels.dtype, target, casting="safe"):
            if np.issubdtype(target, np.integer) and np.issubdtype(pixels.dtype, np.integer):
                lo, hi = int(pixels.min()), int(pixels.max())
                info = np.iinfo(target)
                if lo < info.min or hi > info.max:
                    i32 = np.iinfo(np.int32)
                    self._widen(np.int32 if i32.min <= lo and hi <= i32.max else np.float32)
            elif np.issubdtype(target, np.integer):
                self._widen(np.float32)
        self.data[:, :, k] = pixels.T


def _fix_stored_bits(arr: np.ndarray, h: ImageHeader) -> np.ndarray:
    """Clear unused high bits / sign-extend when BitsStored < BitsAllocated.

    pydicom's native decoder returns the raw allocated word, so a 12-bit signed
    value of -1 arrives as 4095 and stray overlay bits survive.
    """
    unused = h.bits_allocated - h.bits_stored
    if unused <= 0 or arr.dtype.kind not in "iu":
        return arr
    if h.pixel_representation == 1 and arr.dtype.kind == "i":
        return (arr << unused) >> unused
    if arr.dtype.kind == "u":
        return arr & np.array((1 << h.bits_stored) - 1, dtype=arr.dtype)
    return arr


def _rescale(arr: np.ndarray, slope: float, intercept: float, float_output: bool) -> np.ndarray:
    if slope == 1.0 and intercept == 0.0:
        return arr
    if float_output:
        return arr.astype(np.float32) * np.float32(slope) + np.float32(intercept)
    return arr.astype(np.int64) * int(slope) + int(intercept)


def _decode(h: ImageHeader) -> np.ndarray:
    with warnings.catch_warnings():
        # See series._read_header: vendor quirks make pydicom warn on access.
        warnings.simplefilter("ignore")
        return _decode_quiet(h)


def _decode_quiet(h: ImageHeader) -> np.ndarray:
    try:
        with h.source.open() as fh:
            ds = pydicom.dcmread(fh, force=True)
            if "TransferSyntaxUID" not in ds.file_meta:
                # Preamble-less files: let pydicom use what it detected while reading.
                ds.file_meta.TransferSyntaxUID = (
                    pydicom.uid.ImplicitVRLittleEndian if ds.is_implicit_VR
                    else pydicom.uid.ExplicitVRLittleEndian
                )
            arr = ds.pixel_array
    except (NotImplementedError, RuntimeError) as exc:
        name = UID(h.transfer_syntax).name if h.transfer_syntax else "unknown"
        raise DicomConversionError(
            f"The image data is compressed as '{name}', which this installation "
            f"cannot decode (file '{h.source.base_name}')."
        ) from exc
    except Exception as exc:
        raise DicomConversionError(
            f"The image data of '{h.source.base_name}' is damaged and cannot be read."
        ) from exc

    expected = (h.frames, h.rows, h.columns) if h.frames > 1 else (h.rows, h.columns)
    if arr.shape != expected:
        raise DicomConversionError(
            f"'{h.source.base_name}' decodes to {arr.shape}, expected {expected}."
        )
    return arr


def assemble_volume(
    geometry: VolumeGeometry,
    *,
    max_volume_bytes: int = DEFAULT_MAX_VOLUME_BYTES,
    progress: Callable[[float], None] | None = None,
) -> np.ndarray:
    """Decode every slice into a (columns, rows, slices) array."""
    slot: dict[tuple[int, int], int] = {
        (id(ref.header), ref.frame): k for k, ref in enumerate(geometry.frames)
    }
    headers: list[ImageHeader] = list({id(r.header): r.header for r in geometry.frames}.values())

    float_output = any(
        not (_is_integral(s) and _is_integral(b))
        for h in headers for (s, b) in h.frame_rescale
    )
    buffer = _VolumeBuffer(
        geometry.shape, np.float32 if float_output else np.int16, max_volume_bytes
    )
    if any(h.photometric == "MONOCHROME1" for h in headers):
        logger.warning("Series is MONOCHROME1 (inverted grey scale); values kept as stored")

    done = 0
    total = len(geometry.frames)
    for h in headers:
        arr = _fix_stored_bits(_decode(h), h)
        frames = arr if h.frames > 1 else arr[np.newaxis]
        for f in range(h.frames):
            k = slot.get((id(h), f))
            if k is None:
                continue
            slope, intercept = h.frame_rescale[f]
            buffer.put(k, _rescale(frames[f], slope, intercept, float_output))
            done += 1
        del arr, frames
        if progress is not None:
            progress(done / total)
    return buffer.data


def write_nifti(volume: np.ndarray, affine: np.ndarray, path: Path) -> Path:
    """Save as NIfTI-1 in LAS voxel order with scanner-space qform and sform."""
    img = nib.Nifti1Image(volume, affine)
    current = nib.orientations.io_orientation(affine)
    target = nib.orientations.axcodes2ornt(OUTPUT_AXCODES)
    img = img.as_reoriented(nib.orientations.ornt_transform(current, target))
    img.header.set_xyzt_units("mm")
    img.set_qform(img.affine, code=1)
    img.set_sform(img.affine, code=1)
    nib.save(img, str(path))
    return path
