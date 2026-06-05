"""Tests for DICOM -> NIfTI conversion and safe ZIP extraction."""

from __future__ import annotations

import zipfile
from pathlib import Path
from unittest.mock import patch

import nibabel as nib
import numpy as np
import pytest

from backend.workers.subprocesses import dicom_fn


def test_safe_zip_rejects_path_traversal(tmp_path):
    zip_path = tmp_path / "evil.zip"
    out = tmp_path / "out"

    with zipfile.ZipFile(zip_path, "w") as zf:
        zf.writestr("subdir/../../escape.txt", b"x")

    with pytest.raises(ValueError, match="escapes|unsafe"):
        dicom_fn.convert_dicom(
            str(zip_path),
            str(out),
            max_zip_members=100,
            max_uncompressed_zip_bytes=10_000_000,
        )


def test_zip_member_cap(tmp_path):
    zip_path = tmp_path / "many.zip"
    out = tmp_path / "out"
    with zipfile.ZipFile(zip_path, "w") as zf:
        for i in range(5):
            zf.writestr(f"f{i}.txt", b"a")

    with pytest.raises(ValueError, match="too many members"):
        dicom_fn.convert_dicom(
            str(zip_path),
            str(out),
            max_zip_members=2,
            max_uncompressed_zip_bytes=10_000_000,
        )


def test_convert_dicom_success_writes_single_nifti(tmp_path):
    zip_path = tmp_path / "in.zip"
    out = tmp_path / "out"

    def _fake_convert(dicom_in: str, nifti_out: str, **kwargs):
        dest = Path(nifti_out)
        dest.mkdir(parents=True, exist_ok=True)
        img = nib.Nifti1Image(np.zeros((3, 4, 5), dtype=np.float32), np.eye(4))
        nib.save(img, str(dest / "series.nii.gz"))

    with zipfile.ZipFile(zip_path, "w") as zf:
        zf.writestr("dummy.dcm", b"x")

    with patch.object(dicom_fn.dicom2nifti, "convert_directory", _fake_convert):
        result = dicom_fn.convert_dicom(
            str(zip_path),
            str(out),
            max_zip_members=100,
            max_uncompressed_zip_bytes=10_000_000,
        )

    assert Path(result).name == "converted.nii.gz"
    loaded = nib.load(result)
    assert loaded.shape == (3, 4, 5)


def test_convert_dicom_multi_series_picks_largest_volume(tmp_path):
    """CBCT zips often yield several NIfTIs; we keep the spatially largest."""
    zip_path = tmp_path / "in.zip"
    out = tmp_path / "out"

    def _fake_convert(dicom_in: str, nifti_out: str, **kwargs):
        dest = Path(nifti_out)
        dest.mkdir(parents=True, exist_ok=True)
        small = nib.Nifti1Image(np.zeros((2, 2, 2), np.float32), np.eye(4))
        large = nib.Nifti1Image(np.zeros((3, 4, 5), np.float32), np.eye(4))
        nib.save(small, str(dest / "a.nii.gz"))
        nib.save(large, str(dest / "b.nii.gz"))

    with zipfile.ZipFile(zip_path, "w") as zf:
        zf.writestr("a.dcm", b"x")

    with patch.object(dicom_fn.dicom2nifti, "convert_directory", _fake_convert):
        result = dicom_fn.convert_dicom(
            str(zip_path),
            str(out),
            max_zip_members=100,
            max_uncompressed_zip_bytes=10_000_000,
        )

    loaded = nib.load(result)
    assert loaded.shape == (3, 4, 5)


def test_convert_dicom_converts_loose_file(tmp_path):
    """Non-ZIP path: single file copied into staging then converted."""
    dcm = tmp_path / "one.dcm"
    dcm.write_bytes(b"x")
    out = tmp_path / "out"

    def _fake_convert(dicom_in: str, nifti_out: str, **kwargs):
        dest = Path(nifti_out)
        dest.mkdir(parents=True, exist_ok=True)
        img = nib.Nifti1Image(np.ones((2, 2, 2), dtype=np.float32), np.eye(4))
        nib.save(img, str(dest / "only.nii.gz"))

    with patch.object(dicom_fn.dicom2nifti, "convert_directory", _fake_convert):
        result = dicom_fn.convert_dicom(
            str(dcm),
            str(out),
            max_zip_members=100,
            max_uncompressed_zip_bytes=10_000_000,
        )

    assert Path(result).exists()
