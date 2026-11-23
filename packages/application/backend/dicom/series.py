"""Read DICOM headers, group them into series, and work out the volume geometry.

Only headers are read here (``stop_before_pixels``), so scanning a 1 GB upload
costs a few MB of I/O. Single-frame series (one file per slice) and multi-frame
objects (one file holding the whole volume, e.g. Planmeca exports) both end up
as a list of ``FrameRef`` - one per slice - sorted along the slice normal, so
the rest of the pipeline does not care how the slices were stored.
"""

from __future__ import annotations

import logging
import warnings
from collections import Counter, defaultdict
from dataclasses import dataclass, field

import numpy as np
import pydicom
from pydicom.dataset import Dataset

from backend.dicom.errors import DicomConversionError
from backend.dicom.sources import DicomSource

logger = logging.getLogger(__name__)

_PREAMBLE_LEN = 128
_LOCALIZER_TYPES = {"LOCALIZER", "SCOUT"}
# A slice may sit at most this fraction of the slice spacing away from the
# regular grid before the series counts as irregular (missing slices, mixed
# acquisitions). Half a voxel keeps every slice in its own grid cell.
_MAX_GRID_DEVIATION = 0.5
_MIN_SLICES = 3


@dataclass
class ImageHeader:
    """What we need from one DICOM file to place and decode its frames."""

    source: DicomSource
    rows: int
    columns: int
    frames: int
    samples_per_pixel: int
    bits_allocated: int
    bits_stored: int
    pixel_representation: int
    photometric: str
    transfer_syntax: str
    series_uid: str
    sop_uid: str
    instance_number: int | None
    image_type: tuple[str, ...]
    pixel_spacing: tuple[float, float] | None  # (between rows, between columns)
    orientation: np.ndarray | None  # 6 direction cosines (row dir, column dir)
    frame_positions: list[np.ndarray | None]
    frame_rescale: list[tuple[float, float]]
    slice_spacing_hint: float | None  # SpacingBetweenSlices / SliceThickness

    @property
    def is_localizer(self) -> bool:
        return bool(_LOCALIZER_TYPES & {t.upper() for t in self.image_type})

    def series_key(self) -> tuple:
        orient = (
            tuple(np.round(self.orientation, 3)) if self.orientation is not None else None
        )
        spacing = (
            tuple(round(s, 4) for s in self.pixel_spacing) if self.pixel_spacing else None
        )
        return (
            self.series_uid,
            self.rows,
            self.columns,
            self.samples_per_pixel,
            orient,
            spacing,
        )


@dataclass(frozen=True)
class FrameRef:
    header: ImageHeader
    frame: int  # index inside a multi-frame object, 0 for single-frame files


@dataclass
class VolumeGeometry:
    """Sorted slices plus the voxel-to-RAS affine for data indexed [column, row, slice]."""

    frames: list[FrameRef]
    affine: np.ndarray
    rows: int
    columns: int
    warnings: list[str] = field(default_factory=list)

    @property
    def shape(self) -> tuple[int, int, int]:
        return (self.columns, self.rows, len(self.frames))


@dataclass
class ScanSummary:
    headers: list[ImageHeader]
    files_checked: int
    not_dicom: int = 0
    unreadable: int = 0
    non_image: int = 0
    truncated: list[str] = field(default_factory=list)


# --------------------------------------------------------------------------- #
# Header reading
# --------------------------------------------------------------------------- #


def _sniff_dicom(head: bytes) -> bool:
    """DICOM Part 10 files carry 'DICM' after a 128-byte preamble. Older exports
    omit the preamble and start directly with a group 0x0002 or 0x0008 tag."""
    if len(head) >= _PREAMBLE_LEN + 4 and head[_PREAMBLE_LEN:_PREAMBLE_LEN + 4] == b"DICM":
        return True
    if len(head) >= 8:
        group = int.from_bytes(head[0:2], "little")
        return group in (0x0002, 0x0008)
    return False


def _floats(value, n: int) -> np.ndarray | None:
    try:
        arr = np.array([float(v) for v in value], dtype=np.float64)
    except (TypeError, ValueError):
        return None
    return arr if arr.shape == (n,) and np.all(np.isfinite(arr)) else None


def _float_or_none(value) -> float | None:
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return f if np.isfinite(f) else None


def _first_item(ds: Dataset, seq_name: str) -> Dataset | None:
    seq = ds.get(seq_name)
    if seq is None or len(seq) == 0:
        return None
    return seq[0]


def _functional_group_value(ds: Dataset, frame_group: Dataset | None, macro: str, attr: str):
    """Look up an attribute in the per-frame group, then the shared group."""
    for group in (frame_group, _first_item(ds, "SharedFunctionalGroupsSequence")):
        if group is None:
            continue
        item = _first_item(group, macro)
        if item is not None and attr in item:
            return item.get(attr)
    return None


def _orientation(ds: Dataset) -> np.ndarray | None:
    value = ds.get("ImageOrientationPatient")
    if value is None:
        value = _functional_group_value(
            ds,
            _first_item(ds, "PerFrameFunctionalGroupsSequence"),
            "PlaneOrientationSequence",
            "ImageOrientationPatient",
        )
    if value is None:
        return None
    iop = _floats(value, 6)
    if iop is None:
        return None
    row, col = iop[:3], iop[3:]
    if not (np.isclose(np.linalg.norm(row), 1, atol=1e-2)
            and np.isclose(np.linalg.norm(col), 1, atol=1e-2)):
        return None
    return iop


def _pixel_spacing(ds: Dataset) -> tuple[float, float] | None:
    for value in (
        ds.get("PixelSpacing"),
        _functional_group_value(
            ds,
            _first_item(ds, "PerFrameFunctionalGroupsSequence"),
            "PixelMeasuresSequence",
            "PixelSpacing",
        ),
        ds.get("ImagerPixelSpacing"),
    ):
        if value is not None:
            ps = _floats(value, 2)
            if ps is not None and np.all(ps > 0):
                return float(ps[0]), float(ps[1])
    return None


def _slice_spacing_hint(ds: Dataset) -> float | None:
    per_frame = _first_item(ds, "PerFrameFunctionalGroupsSequence")
    for value in (
        ds.get("SpacingBetweenSlices"),
        _functional_group_value(ds, per_frame, "PixelMeasuresSequence", "SpacingBetweenSlices"),
        ds.get("SliceThickness"),
        _functional_group_value(ds, per_frame, "PixelMeasuresSequence", "SliceThickness"),
    ):
        f = _float_or_none(value)
        if f is not None and f > 0:
            return abs(f)
    return None


def _rescale(ds: Dataset, frame_group: Dataset | None) -> tuple[float, float]:
    slope = _functional_group_value(ds, frame_group, "PixelValueTransformationSequence", "RescaleSlope")
    inter = _functional_group_value(ds, frame_group, "PixelValueTransformationSequence", "RescaleIntercept")
    if slope is None:
        slope = ds.get("RescaleSlope")
    if inter is None:
        inter = ds.get("RescaleIntercept")
    s = _float_or_none(slope)
    b = _float_or_none(inter)
    return (s if s not in (None, 0.0) else 1.0, b if b is not None else 0.0)


def _frame_geometry(ds: Dataset, frames: int) -> tuple[list[np.ndarray | None], list[tuple[float, float]]]:
    per_frame = ds.get("PerFrameFunctionalGroupsSequence")
    positions: list[np.ndarray | None] = []
    rescales: list[tuple[float, float]] = []
    if per_frame is not None and len(per_frame) == frames:
        for item in per_frame:
            pos = _functional_group_value(ds, item, "PlanePositionSequence", "ImagePositionPatient")
            positions.append(_floats(pos, 3) if pos is not None else None)
            rescales.append(_rescale(ds, item))
        return positions, rescales

    origin = _floats(ds.get("ImagePositionPatient"), 3) if "ImagePositionPatient" in ds else None
    rescale = _rescale(ds, None)
    if frames == 1:
        return [origin], [rescale]

    # Legacy multi-frame without per-frame positions: frames are evenly spaced
    # along the slice normal, starting at ImagePositionPatient.
    iop = _orientation(ds)
    offsets = ds.get("GridFrameOffsetVector")
    offsets = _floats(offsets, frames) if offsets is not None else None
    if offsets is None:
        step = _slice_spacing_hint(ds)
        offsets = None if step is None else np.arange(frames, dtype=np.float64) * step
    if origin is None or iop is None or offsets is None:
        return [None] * frames, [rescale] * frames
    normal = np.cross(iop[:3], iop[3:])
    return [origin + normal * off for off in offsets], [rescale] * frames


def _read_header(source: DicomSource, summary: ScanSummary) -> ImageHeader | None:
    # Vendors routinely write slightly invalid values (e.g. Vatech UIDs with
    # leading zeros). pydicom warns when an element is first accessed, so the
    # whole extraction runs with warnings off - otherwise every slice logs noise.
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        return _read_header_quiet(source, summary)


def _read_header_quiet(source: DicomSource, summary: ScanSummary) -> ImageHeader | None:
    try:
        with source.open() as fh:
            if not _sniff_dicom(fh.read(_PREAMBLE_LEN + 4)):
                summary.not_dicom += 1
                return None
            fh.seek(0)
            ds = pydicom.dcmread(fh, stop_before_pixels=True, force=True)
            remaining = source.size - fh.tell()
    except Exception:
        logger.debug("Unreadable DICOM header: %s", source.base_name, exc_info=True)
        summary.unreadable += 1
        return None

    try:
        rows = int(ds.Rows)
        cols = int(ds.Columns)
        bits_allocated = int(ds.BitsAllocated)
    except (AttributeError, TypeError, ValueError):
        summary.non_image += 1  # DICOMDIR, structured reports, presentation states...
        return None
    if rows <= 0 or cols <= 0 or remaining <= 0:
        summary.non_image += 1
        return None

    frames = int(ds.get("NumberOfFrames", 1) or 1)
    spp = int(ds.get("SamplesPerPixel", 1) or 1)
    file_meta = getattr(ds, "file_meta", None)
    transfer_syntax = str(getattr(file_meta, "TransferSyntaxUID", "") or "")
    encapsulated = bool(file_meta is not None and "TransferSyntaxUID" in file_meta
                        and file_meta.TransferSyntaxUID.is_compressed)
    if not encapsulated:
        expected = (rows * cols * frames * spp * bits_allocated + 7) // 8
        if remaining < expected:
            summary.truncated.append(source.base_name)
            return None

    positions, rescales = _frame_geometry(ds, frames)
    instance = ds.get("InstanceNumber")
    try:
        instance_number = int(instance) if instance not in (None, "") else None
    except (TypeError, ValueError):
        instance_number = None

    return ImageHeader(
        source=source,
        rows=rows,
        columns=cols,
        frames=frames,
        samples_per_pixel=spp,
        bits_allocated=bits_allocated,
        bits_stored=int(ds.get("BitsStored", bits_allocated) or bits_allocated),
        pixel_representation=int(ds.get("PixelRepresentation", 0) or 0),
        photometric=str(ds.get("PhotometricInterpretation", "MONOCHROME2")).strip().upper(),
        transfer_syntax=transfer_syntax,
        series_uid=str(ds.get("SeriesInstanceUID", "") or ""),
        sop_uid=str(ds.get("SOPInstanceUID", "") or ""),
        instance_number=instance_number,
        image_type=tuple(str(t) for t in (ds.get("ImageType") or ())),
        pixel_spacing=_pixel_spacing(ds),
        orientation=_orientation(ds),
        frame_positions=positions,
        frame_rescale=rescales,
        slice_spacing_hint=_slice_spacing_hint(ds),
    )


def scan_headers(sources: list[DicomSource], progress=None) -> ScanSummary:
    summary = ScanSummary(headers=[], files_checked=len(sources))
    for i, source in enumerate(sources):
        header = _read_header(source, summary)
        if header is not None:
            summary.headers.append(header)
        if progress is not None and (i % 50 == 0 or i == len(sources) - 1):
            progress((i + 1) / max(len(sources), 1))
    return summary


# --------------------------------------------------------------------------- #
# Series selection
# --------------------------------------------------------------------------- #


def _dedupe(headers: list[ImageHeader]) -> list[ImageHeader]:
    """Drop repeated copies of the same instance (same file exported twice)."""
    seen: set[str] = set()
    out = []
    for h in headers:
        if h.sop_uid and h.sop_uid in seen:
            continue
        if h.sop_uid:
            seen.add(h.sop_uid)
        out.append(h)
    return out


def select_volume_series(summary: ScanSummary) -> list[ImageHeader]:
    """Pick the series that forms the largest 3D grayscale volume."""
    if summary.truncated:
        # A truncated file has no usable header, so we cannot tell which series
        # it belonged to; if it was the first/last slice the volume would just
        # silently shrink. Any truncation means the export is broken.
        raise DicomConversionError(
            f"{len(summary.truncated)} DICOM file(s) are cut short (e.g. "
            f"'{summary.truncated[0]}'). The export or copy was probably "
            "interrupted - export the scan again."
        )
    if not summary.headers:
        raise DicomConversionError(
            "No DICOM images were found in the upload "
            f"({summary.files_checked} file(s) checked: {summary.not_dicom} not DICOM, "
            f"{summary.non_image} DICOM without image data, "
            f"{summary.unreadable} unreadable). Upload a ZIP of the scan's DICOM "
            "folder or a single multi-frame DICOM file."
        )

    groups: dict[tuple, list[ImageHeader]] = defaultdict(list)
    for h in summary.headers:
        groups[h.series_key()].append(h)

    candidates = []
    rejected = Counter()
    for key, members in groups.items():
        members = _dedupe(members)
        n_slices = sum(h.frames for h in members)
        first = members[0]
        if first.samples_per_pixel != 1:
            rejected["colour images (screenshots or photos)"] += 1
            continue
        if first.is_localizer:
            rejected["localizer/scout images"] += 1
            continue
        if n_slices < _MIN_SLICES:
            rejected["single 2D images (e.g. panoramic or cross-section views)"] += 1
            continue
        voxels = first.rows * first.columns * n_slices
        candidates.append((voxels, n_slices, key, members))

    if not candidates:
        detail = ", ".join(f"{n} series of {what}" for what, n in rejected.items())
        raise DicomConversionError(
            "The upload contains DICOM images but no 3D volume"
            + (f" (found {detail})" if detail else "")
            + ". Export the full CBCT/CT volume as a DICOM series."
        )

    candidates.sort(key=lambda c: (c[0], c[1]), reverse=True)
    voxels, n_slices, _key, members = candidates[0]
    if len(candidates) > 1:
        logger.info(
            "Found %d volume series; using the largest (%d slices, %d voxels)",
            len(candidates), n_slices, voxels,
        )
    return members


# --------------------------------------------------------------------------- #
# Geometry
# --------------------------------------------------------------------------- #


def _frames_in_order(members: list[ImageHeader]) -> list[FrameRef]:
    return [FrameRef(h, f) for h in members for f in range(h.frames)]


def build_geometry(members: list[ImageHeader]) -> VolumeGeometry:
    """Sort slices along the slice normal and derive the voxel-to-RAS affine."""
    first = members[0]
    notes: list[str] = []
    frames = _frames_in_order(members)

    iop = first.orientation
    if iop is None:
        iop = np.array([1.0, 0, 0, 0, 1.0, 0])
        notes.append("no ImageOrientationPatient; assumed axial slices")
    row_dir, col_dir = iop[:3], iop[3:]
    normal = np.cross(row_dir, col_dir)

    if first.pixel_spacing is None:
        notes.append("no PixelSpacing; assumed 1 mm pixels")
        d_row, d_col = 1.0, 1.0
    else:
        d_row, d_col = first.pixel_spacing

    positions = [ref.header.frame_positions[ref.frame] for ref in frames]
    if all(p is not None for p in positions):
        pos = np.array(positions)
        dist = pos @ normal
        order = np.lexsort((
            [ref.header.instance_number or 0 for ref in frames],
            [ref.frame for ref in frames],
            dist,
        ))
        frames = [frames[i] for i in order]
        pos, dist = pos[order], dist[order]
        diffs = np.diff(dist)
        spacing = float(np.median(diffs)) if len(diffs) else 0.0
        if spacing <= 1e-6:
            raise DicomConversionError(
                "Several images of the series share the same slice position, so they "
                "do not form one volume (the series may mix several scans). Export "
                "only the CBCT volume."
            )
        _check_regular_spacing(dist, spacing)
        # Slice step from first to last slice (as dcm2niix/dicom2nifti do); for a
        # gantry tilt this keeps the shear instead of silently squaring the volume.
        step = (pos[-1] - pos[0]) / (len(frames) - 1)
        tilt = np.degrees(np.arccos(np.clip(abs(step @ normal) / np.linalg.norm(step), -1, 1)))
        if tilt > 0.5:
            notes.append(f"slices are sheared by {tilt:.1f} deg (gantry tilt); kept as-is")
        origin = pos[0]
    else:
        hint = first.slice_spacing_hint
        if hint is None:
            raise DicomConversionError(
                "The slices carry no position information (ImagePositionPatient) "
                "and no slice spacing, so they cannot be stacked into a volume."
            )
        frames.sort(key=lambda r: (r.header.instance_number or 0, r.frame))
        notes.append("no slice positions; ordered by InstanceNumber with SliceThickness spacing")
        step = normal * hint
        p0 = frames[0].header.frame_positions[frames[0].frame]
        origin = p0 if p0 is not None else np.zeros(3)

    # DICOM patient space is LPS; NIfTI world space is RAS. Data is indexed
    # [column (i), row (j), slice (k)], see nibabel's DICOM orientation notes.
    lps = np.eye(4)
    lps[:3, 0] = row_dir * d_col
    lps[:3, 1] = col_dir * d_row
    lps[:3, 2] = step
    lps[:3, 3] = origin
    affine = np.diag([-1.0, -1.0, 1.0, 1.0]) @ lps

    for note in notes:
        logger.warning("DICOM geometry: %s", note)
    return VolumeGeometry(
        frames=frames,
        affine=affine,
        rows=first.rows,
        columns=first.columns,
        warnings=notes,
    )


def _check_regular_spacing(dist: np.ndarray, spacing: float) -> None:
    n = len(dist)
    grid = dist[0] + spacing * np.arange(n)
    deviation = np.abs(dist - grid) / spacing
    if float(deviation.max()) <= _MAX_GRID_DEVIATION:
        return
    expected = int(round((dist[-1] - dist[0]) / spacing)) + 1
    if expected > n:
        raise DicomConversionError(
            f"The series is missing {expected - n} of {expected} slices "
            f"(slice spacing {spacing:.3g} mm). The export is incomplete - export "
            "the full volume again."
        )
    raise DicomConversionError(
        f"The slices are not evenly spaced (typical spacing {spacing:.3g} mm, but "
        "some slices are off the grid). The series may mix several scans; export "
        "only the CBCT volume."
    )
