"""DICOM -> NIfTI conversion against real (synthetic) DICOM data.

The main invariant: for every source voxel, its DICOM-defined world position
maps through the output NIfTI's affine onto a voxel holding the same value.
That checks ordering, orientation, affine and pixel values in one go, without
depending on how the converter is implemented.
"""

from __future__ import annotations

import io
import random
import zipfile
from pathlib import Path

import nibabel as nib
import numpy as np
import pydicom
import pytest
from pydicom.uid import ImplicitVRLittleEndian, RLELossless, generate_uid

from backend.dicom import DicomConversionError
from backend.workers.subprocesses import dicom_fn

from .dicom_factory import (
    SeriesSpec,
    enhanced_multiframe_file,
    expected_volume,
    single_frame_files,
    write_zip,
)

LIMITS = dict(max_zip_members=1000, max_uncompressed_zip_bytes=100_000_000)
TEST_FILES = Path(__file__).resolve().parents[2].parent / "test_files"


def convert(input_path: Path, tmp_path: Path, **overrides) -> nib.Nifti1Image:
    kwargs = {**LIMITS, **overrides}
    out = dicom_fn.convert_dicom(str(input_path), str(tmp_path / "out"), **kwargs)
    assert Path(out).name == "converted.nii.gz"
    return nib.load(out)


def assert_matches_dicom(img: nib.Nifti1Image, spec: SeriesSpec) -> None:
    data = np.asarray(img.dataobj)
    # Reorientation may permute axes (e.g. sagittal input), so compare sizes only;
    # the per-voxel mapping below is the real check, and together with the
    # size it proves the mapping is a bijection onto the output grid.
    assert data.size == spec.columns * spec.rows * spec.slices
    expected = expected_volume(spec)
    inv = np.linalg.inv(img.affine)
    seen: set[tuple[int, ...]] = set()
    for i in range(spec.columns):
        for j in range(spec.rows):
            for k in range(spec.slices):
                lps = spec.expected_lps(i, j, k)
                ras = np.array([-lps[0], -lps[1], lps[2], 1.0])
                vox = inv @ ras
                idx = tuple(int(v) for v in np.round(vox[:3]))
                assert np.allclose(vox[:3], idx, atol=1e-3), (i, j, k, vox)
                assert data[idx] == pytest.approx(expected[i, j, k]), (i, j, k)
                seen.add(idx)
    assert len(seen) == data.size


def zip_series(tmp_path: Path, files: list[bytes], *, folder="scan", name="in.zip", extra=None) -> Path:
    members = {f"{folder}/IM{k:05d}": data for k, data in enumerate(files)}
    members.update(extra or {})
    return write_zip(tmp_path / name, members)


# --------------------------------------------------------------------------- #
# Happy paths
# --------------------------------------------------------------------------- #


def test_zip_series_converts_with_correct_geometry_and_values(tmp_path):
    spec = SeriesSpec()
    img = convert(zip_series(tmp_path, single_frame_files(spec)), tmp_path)
    assert_matches_dicom(img, spec)
    assert nib.aff2axcodes(img.affine) == ("L", "A", "S")
    assert img.header.get_zooms() == pytest.approx((0.3, 0.4, 0.5))
    assert img.get_data_dtype() == np.int16
    assert int(img.header["qform_code"]) == 1 and int(img.header["sform_code"]) == 1


def test_file_order_in_archive_does_not_matter(tmp_path):
    spec = SeriesSpec(slices=7)
    files = single_frame_files(spec)
    random.Random(3).shuffle(files)
    img = convert(zip_series(tmp_path, files), tmp_path)
    assert_matches_dicom(img, spec)


@pytest.mark.parametrize(
    "orientation",
    [
        (0.0, 1.0, 0.0, 0.0, 0.0, -1.0),  # sagittal
        (1.0, 0.0, 0.0, 0.0, 0.0, -1.0),  # coronal
        (-1.0, 0.0, 0.0, 0.0, -1.0, 0.0),  # axial, feet-first style flip
        (0.9659258, 0.2588190, 0.0, -0.2588190, 0.9659258, 0.0),  # 15 deg oblique
    ],
)
def test_non_axial_and_oblique_orientations(tmp_path, orientation):
    spec = SeriesSpec(orientation=orientation)
    img = convert(zip_series(tmp_path, single_frame_files(spec)), tmp_path)
    assert_matches_dicom(img, spec)


def test_negative_slice_direction(tmp_path):
    spec = SeriesSpec(slice_spacing=-0.5)
    img = convert(zip_series(tmp_path, single_frame_files(spec)), tmp_path)
    assert_matches_dicom(img, spec)


def test_macos_metadata_and_viewer_files_are_ignored(tmp_path):
    """A ZIP made in macOS Finder has an AppleDouble twin for every file."""
    spec = SeriesSpec()
    files = single_frame_files(spec)
    extra = {f"__MACOSX/scan/._IM{k:05d}": b"\x00\x05\x16\x07junk" for k in range(len(files))}
    extra.update({
        "scan/.DS_Store": b"junk",
        "viewer/Viewer.exe": b"MZ" + b"\0" * 64,
        "README.txt": b"open viewer.exe",
        "scan/preview.jpg": b"\xff\xd8\xff",
    })
    img = convert(zip_series(tmp_path, files, extra=extra), tmp_path)
    assert_matches_dicom(img, spec)


def test_dicomdir_and_non_image_objects_are_ignored(tmp_path):
    spec = SeriesSpec()
    ds = pydicom.Dataset()
    ds.file_meta = pydicom.dataset.FileMetaDataset()
    ds.file_meta.TransferSyntaxUID = pydicom.uid.ExplicitVRLittleEndian
    ds.file_meta.MediaStorageSOPClassUID = "1.2.840.10008.1.3.10"  # Media Storage Directory
    ds.file_meta.MediaStorageSOPInstanceUID = generate_uid()
    ds.SOPClassUID = "1.2.840.10008.1.3.10"
    ds.is_little_endian, ds.is_implicit_VR = True, False
    buf = io.BytesIO()
    pydicom.dcmwrite(buf, pydicom.dataset.FileDataset(None, ds, file_meta=ds.file_meta, preamble=b"\0" * 128))
    img = convert(zip_series(tmp_path, single_frame_files(spec), extra={"DICOMDIR": buf.getvalue()}), tmp_path)
    assert_matches_dicom(img, spec)


def test_largest_volume_is_chosen_over_scout_and_smaller_series(tmp_path):
    volume = SeriesSpec(slices=6, seed=1)
    small = SeriesSpec(rows=3, columns=3, slices=3, seed=2)
    scout = SeriesSpec(rows=8, columns=8, slices=1, image_type=("ORIGINAL", "PRIMARY", "LOCALIZER"), seed=3)
    pano = SeriesSpec(rows=9, columns=12, slices=1, seed=4)
    extra = {}
    for tag, spec in (("small", small), ("scout", scout), ("pano", pano)):
        for k, data in enumerate(single_frame_files(spec)):
            extra[f"{tag}/{k}.dcm"] = data
    img = convert(zip_series(tmp_path, single_frame_files(volume), extra=extra), tmp_path)
    assert_matches_dicom(img, volume)


def test_duplicate_copies_of_the_same_files_are_merged(tmp_path):
    spec = SeriesSpec()
    files = single_frame_files(spec)
    extra = {f"copy/IM{k:05d}": data for k, data in enumerate(files)}
    img = convert(zip_series(tmp_path, files, extra=extra), tmp_path)
    assert_matches_dicom(img, spec)


def test_enhanced_multiframe_single_file(tmp_path):
    spec = SeriesSpec(slices=5)
    path = tmp_path / "volume.dcm"
    path.write_bytes(enhanced_multiframe_file(spec))
    img = convert(path, tmp_path)
    assert_matches_dicom(img, spec)


def test_legacy_multiframe_without_per_frame_positions(tmp_path):
    spec = SeriesSpec(slices=5)
    path = tmp_path / "volume.dcm"
    path.write_bytes(enhanced_multiframe_file(spec, per_frame_positions=False))
    img = convert(path, tmp_path)
    assert_matches_dicom(img, spec)


def test_rle_compressed_series(tmp_path):
    spec = SeriesSpec()
    files = single_frame_files(spec, transfer_syntax=RLELossless)
    img = convert(zip_series(tmp_path, files), tmp_path)
    assert_matches_dicom(img, spec)


def test_preamble_less_implicit_vr_files(tmp_path):
    spec = SeriesSpec()
    files = single_frame_files(spec, transfer_syntax=ImplicitVRLittleEndian, preamble=False)
    assert files[0][128:132] != b"DICM"
    img = convert(zip_series(tmp_path, files), tmp_path)
    assert_matches_dicom(img, spec)


def test_directory_input(tmp_path):
    spec = SeriesSpec()
    src = tmp_path / "dicoms" / "nested"
    src.mkdir(parents=True)
    for k, data in enumerate(single_frame_files(spec)):
        (src / f"slice{k}").write_bytes(data)
    img = convert(tmp_path / "dicoms", tmp_path)
    assert_matches_dicom(img, spec)


def test_missing_positions_fall_back_to_instance_number(tmp_path):
    spec = SeriesSpec()
    files = single_frame_files(spec, with_positions=False)
    random.Random(1).shuffle(files)
    img = convert(zip_series(tmp_path, files), tmp_path)
    data = np.asarray(img.dataobj)
    # Without positions the stack starts at the origin; values must still be in slice order.
    assert data.shape == (spec.columns, spec.rows, spec.slices)
    expected = expected_volume(spec)
    las = nib.orientations.apply_orientation(
        expected,
        nib.orientations.ornt_transform(
            nib.orientations.axcodes2ornt(("L", "P", "S")),
            nib.orientations.axcodes2ornt(("L", "A", "S")),
        ),
    )
    assert np.array_equal(data, las)
    assert img.header.get_zooms()[2] == pytest.approx(spec.slice_spacing)


# --------------------------------------------------------------------------- #
# Pixel value handling
# --------------------------------------------------------------------------- #


def test_unsigned_with_integer_intercept_becomes_int16(tmp_path):
    spec = SeriesSpec(dtype="uint16", bits_stored=12, intercept=-1024)
    img = convert(zip_series(tmp_path, single_frame_files(spec)), tmp_path)
    assert img.get_data_dtype() == np.int16
    assert_matches_dicom(img, spec)


def test_fractional_rescale_becomes_float32(tmp_path):
    spec = SeriesSpec(slope=0.5, intercept=-0.25)
    img = convert(zip_series(tmp_path, single_frame_files(spec)), tmp_path)
    assert img.get_data_dtype() == np.float32
    assert_matches_dicom(img, spec)


def test_values_beyond_int16_widen_instead_of_wrapping(tmp_path):
    spec = SeriesSpec(dtype="uint16")  # full 16-bit unsigned range
    img = convert(zip_series(tmp_path, single_frame_files(spec)), tmp_path)
    assert img.get_data_dtype() == np.int32
    assert_matches_dicom(img, spec)


def test_signed_12_bit_values_are_sign_extended(tmp_path):
    spec = SeriesSpec(dtype="int16", bits_stored=12)
    img = convert(zip_series(tmp_path, single_frame_files(spec)), tmp_path)
    assert np.asarray(img.dataobj).min() < 0
    assert_matches_dicom(img, spec)


# --------------------------------------------------------------------------- #
# Broken uploads get a clear error
# --------------------------------------------------------------------------- #


def test_truncated_zip_download_is_reported(tmp_path):
    spec = SeriesSpec()
    full = zip_series(tmp_path, single_frame_files(spec)).read_bytes()
    partial = tmp_path / "partial.zip"
    partial.write_bytes(full[: len(full) // 2])  # like an unfinished browser download
    with pytest.raises(DicomConversionError, match="incomplete"):
        convert(partial, tmp_path)


def test_truncated_dicom_file_is_reported(tmp_path):
    spec = SeriesSpec()
    files = single_frame_files(spec)
    files[2] = files[2][:-20]
    with pytest.raises(DicomConversionError, match="cut short"):
        convert(zip_series(tmp_path, files), tmp_path)


def test_missing_slice_is_reported(tmp_path):
    spec = SeriesSpec(slices=6)
    files = single_frame_files(spec)
    del files[3]
    with pytest.raises(DicomConversionError, match="missing 1 of 6 slices"):
        convert(zip_series(tmp_path, files), tmp_path)


def test_zip_without_dicom_is_reported(tmp_path):
    path = write_zip(tmp_path / "x.zip", {"notes.md": b"hello", "data.bin": b"\x01\x02" * 100})
    with pytest.raises(DicomConversionError, match="No DICOM images"):
        convert(path, tmp_path)


def test_single_2d_image_is_reported(tmp_path):
    with pytest.raises(DicomConversionError, match="no 3D volume"):
        convert(TEST_FILES / "N2D_0001.dcm", tmp_path)


def test_volume_size_limit(tmp_path):
    spec = SeriesSpec()
    with pytest.raises(DicomConversionError, match="too large"):
        convert(zip_series(tmp_path, single_frame_files(spec)), tmp_path, max_volume_bytes=100)


def test_zip_member_cap(tmp_path):
    path = write_zip(tmp_path / "many.zip", {f"f{i}.txt": b"a" for i in range(5)})
    with pytest.raises(DicomConversionError, match="too many files"):
        convert(path, tmp_path, max_zip_members=2)


def test_zip_uncompressed_size_cap(tmp_path):
    path = write_zip(tmp_path / "big.zip", {"a.dcm": b"\0" * 10_000})
    with pytest.raises(DicomConversionError, match="unpacks to"):
        convert(path, tmp_path, max_uncompressed_zip_bytes=1000)


def test_zip_member_paths_are_never_written_to_disk(tmp_path):
    """Members are read in place, so '../' names cannot escape anywhere."""
    spec = SeriesSpec()
    members = {f"../../escape/IM{k}": d for k, d in enumerate(single_frame_files(spec))}
    path = write_zip(tmp_path / "evil.zip", members)
    img = convert(path, tmp_path)
    assert_matches_dicom(img, spec)
    assert not (tmp_path.parent / "escape").exists()
    assert sorted(p.name for p in (tmp_path / "out").iterdir()) == ["converted.nii.gz"]


def test_unsupported_zip_compression_is_reported(tmp_path):
    spec = SeriesSpec()
    path = zip_series(tmp_path, single_frame_files(spec))
    raw = bytearray(path.read_bytes())
    # Patch every central-directory entry's method to 9 (Deflate64, made by Windows Explorer).
    pos = raw.find(b"PK\x01\x02")
    while pos != -1:
        raw[pos + 10:pos + 12] = (9).to_bytes(2, "little")
        pos = raw.find(b"PK\x01\x02", pos + 4)
    path.write_bytes(bytes(raw))
    with pytest.raises(DicomConversionError, match="Deflate64"):
        convert(path, tmp_path)


def test_progress_is_reported_monotonically_up_to_one(tmp_path):
    class Q:
        def __init__(self):
            self.items = []

        def put(self, v):
            self.items.append(v)

    q = Q()
    spec = SeriesSpec()
    dicom_fn.convert_dicom(
        str(zip_series(tmp_path, single_frame_files(spec))), str(tmp_path / "out"),
        LIMITS["max_zip_members"], LIMITS["max_uncompressed_zip_bytes"], q,
    )
    assert q.items[-1] == 1.0
    assert q.items == sorted(q.items)
