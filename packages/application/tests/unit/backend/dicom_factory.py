"""Build small synthetic DICOM series for converter tests.

The geometry follows the DICOM definition directly (PS3.3 C.7.6.2.1.1), so tests
can check the converter's affine against an independent computation:
world_LPS(col i, row j, slice k) = IPP_k + i * col_spacing * row_dir + j * row_spacing * col_dir
"""

from __future__ import annotations

import io
import zipfile
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pydicom
from pydicom.dataset import Dataset, FileDataset, FileMetaDataset
from pydicom.sequence import Sequence
from pydicom.uid import (
    CTImageStorage,
    EnhancedCTImageStorage,
    ExplicitVRLittleEndian,
    ImplicitVRLittleEndian,
    RLELossless,
    generate_uid,
)

AXIAL = (1.0, 0.0, 0.0, 0.0, 1.0, 0.0)


@dataclass
class SeriesSpec:
    rows: int = 6
    columns: int = 5
    slices: int = 4
    pixel_spacing: tuple[float, float] = (0.4, 0.3)  # (between rows, between columns)
    slice_spacing: float = 0.5
    orientation: tuple[float, ...] = AXIAL
    origin: tuple[float, float, float] = (-10.0, 20.0, 30.0)
    dtype: str = "int16"
    bits_stored: int | None = None
    slope: float = 1.0
    intercept: float = 0.0
    image_type: tuple[str, ...] = ("ORIGINAL", "PRIMARY", "AXIAL")
    series_uid: str = field(default_factory=generate_uid)
    seed: int = 0

    @property
    def normal(self) -> np.ndarray:
        o = np.array(self.orientation)
        return np.cross(o[:3], o[3:])

    def position(self, k: int) -> np.ndarray:
        return np.array(self.origin) + self.normal * self.slice_spacing * k

    def stored_pixels(self) -> np.ndarray:
        """(slices, rows, columns) stored values; each voxel is unique and traceable."""
        rng = np.random.default_rng(self.seed)
        dt = np.dtype(self.dtype)
        bits = self.bits_stored or dt.itemsize * 8
        if dt.kind == "i":
            lo, hi = -(2 ** (bits - 1)), 2 ** (bits - 1) - 1
        else:
            lo, hi = 0, 2**bits - 1
        return rng.integers(lo, hi, size=(self.slices, self.rows, self.columns), endpoint=True).astype(dt)

    def expected_lps(self, i: int, j: int, k: int) -> np.ndarray:
        o = np.array(self.orientation)
        d_row, d_col = self.pixel_spacing
        return self.position(k) + i * d_col * o[:3] + j * d_row * o[3:]


def _base_dataset(spec: SeriesSpec, sop_class: str, transfer_syntax: str, preamble: bool = True) -> FileDataset:
    meta = FileMetaDataset()
    meta.MediaStorageSOPClassUID = sop_class
    meta.MediaStorageSOPInstanceUID = generate_uid()
    meta.TransferSyntaxUID = transfer_syntax
    ds = FileDataset(None, {}, file_meta=meta, preamble=b"\0" * 128 if preamble else None)
    ds.SOPClassUID = sop_class
    ds.SOPInstanceUID = meta.MediaStorageSOPInstanceUID
    ds.Modality = "CT"
    ds.PatientName = "Test^Synthetic"
    ds.StudyInstanceUID = "1.2.3.4"
    ds.SeriesInstanceUID = spec.series_uid
    ds.ImageType = list(spec.image_type)
    ds.Rows, ds.Columns = spec.rows, spec.columns
    dt = np.dtype(spec.dtype)
    ds.BitsAllocated = dt.itemsize * 8
    ds.BitsStored = spec.bits_stored or dt.itemsize * 8
    ds.HighBit = ds.BitsStored - 1
    ds.PixelRepresentation = 1 if dt.kind == "i" else 0
    ds.SamplesPerPixel = 1
    ds.PhotometricInterpretation = "MONOCHROME2"
    ds.is_little_endian = True
    ds.is_implicit_VR = transfer_syntax == ImplicitVRLittleEndian
    return ds


def _raw_word(values: np.ndarray, spec: SeriesSpec) -> np.ndarray:
    """Pack stored values into the allocated word as a real device would (no sign bits above HighBit)."""
    if spec.bits_stored and np.dtype(spec.dtype).kind == "i":
        mask = (1 << spec.bits_stored) - 1
        return (values.astype(np.int32) & mask).astype(np.uint16).view(np.int16)
    return values


def single_frame_files(
    spec: SeriesSpec,
    *,
    transfer_syntax: str = ExplicitVRLittleEndian,
    with_positions: bool = True,
    preamble: bool = True,
) -> list[bytes]:
    """One encoded file per slice, in slice order."""
    pixels = spec.stored_pixels()
    out = []
    for k in range(spec.slices):
        ds = _base_dataset(spec, CTImageStorage, transfer_syntax, preamble)
        ds.InstanceNumber = k + 1
        ds.ImageOrientationPatient = [f"{v:.6f}" for v in spec.orientation]
        if with_positions:
            ds.ImagePositionPatient = [f"{v:.6f}" for v in spec.position(k)]
        ds.PixelSpacing = [str(v) for v in spec.pixel_spacing]
        ds.SliceThickness = str(spec.slice_spacing)
        ds.RescaleSlope = str(spec.slope)
        ds.RescaleIntercept = str(spec.intercept)
        word = _raw_word(pixels[k], spec)
        if transfer_syntax == RLELossless:
            ds.PixelData = word.tobytes()
            ds.compress(RLELossless, word)
        else:
            ds.PixelData = word.tobytes()
        out.append(_encode(ds, preamble))
    return out


def enhanced_multiframe_file(spec: SeriesSpec, *, per_frame_positions: bool = True) -> bytes:
    """One Enhanced-CT-style file holding every slice as a frame."""
    pixels = spec.stored_pixels()
    ds = _base_dataset(spec, EnhancedCTImageStorage, ExplicitVRLittleEndian)
    ds.InstanceNumber = 1
    ds.NumberOfFrames = spec.slices

    shared = Dataset()
    orient = Dataset()
    orient.ImageOrientationPatient = [f"{v:.6f}" for v in spec.orientation]
    measures = Dataset()
    measures.PixelSpacing = [str(v) for v in spec.pixel_spacing]
    measures.SliceThickness = str(spec.slice_spacing)
    measures.SpacingBetweenSlices = str(spec.slice_spacing)
    transform = Dataset()
    transform.RescaleSlope = str(spec.slope)
    transform.RescaleIntercept = str(spec.intercept)
    shared.PlaneOrientationSequence = Sequence([orient])
    shared.PixelMeasuresSequence = Sequence([measures])
    shared.PixelValueTransformationSequence = Sequence([transform])
    ds.SharedFunctionalGroupsSequence = Sequence([shared])

    if per_frame_positions:
        frames = []
        for k in range(spec.slices):
            item = Dataset()
            pos = Dataset()
            pos.ImagePositionPatient = [f"{v:.6f}" for v in spec.position(k)]
            item.PlanePositionSequence = Sequence([pos])
            frames.append(item)
        ds.PerFrameFunctionalGroupsSequence = Sequence(frames)
    else:
        ds.ImagePositionPatient = [f"{v:.6f}" for v in spec.position(0)]
        ds.ImageOrientationPatient = [f"{v:.6f}" for v in spec.orientation]
        ds.SpacingBetweenSlices = str(spec.slice_spacing)
    ds.PixelData = _raw_word(pixels, spec).tobytes()
    return _encode(ds, True)


def _encode(ds: FileDataset, preamble: bool) -> bytes:
    buf = io.BytesIO()
    if preamble:
        pydicom.dcmwrite(buf, ds, write_like_original=False)
    else:
        # Old ACR-NEMA style: bare dataset, no preamble, no 'DICM', no file meta.
        ds.preamble = None
        ds.file_meta = FileMetaDataset()
        pydicom.dcmwrite(buf, ds, write_like_original=True)
    return buf.getvalue()


def write_zip(path: Path, members: dict[str, bytes], *, compression=zipfile.ZIP_DEFLATED) -> Path:
    with zipfile.ZipFile(path, "w", compression=compression) as zf:
        for name, data in members.items():
            zf.writestr(name, data)
    return path


def expected_volume(spec: SeriesSpec) -> np.ndarray:
    """Values the converter should produce, indexed [column, row, slice] in DICOM order."""
    stored = spec.stored_pixels().astype(np.float64) * spec.slope + spec.intercept
    return np.transpose(stored, (2, 1, 0))
