"""Tests for DICOM -> NIfTI conversion and safe ZIP extraction."""

from __future__ import annotations

import json
import zipfile
from pathlib import Path
from unittest.mock import patch

import nibabel as nib
import numpy as np
import pytest

from backend.workers.subprocesses import dicom_fn


def _write_nifti(path: Path, shape: tuple[int, int, int]) -> None:
    img = nib.Nifti1Image(np.zeros(shape, dtype=np.float32), np.eye(4))
    nib.save(img, str(path))


def _write_sidecar(nifti_path: Path, image_type: list[str]) -> None:
    """Write a BIDS sidecar next to ``foo.nii.gz`` as ``foo.json``."""
    sidecar = nifti_path.with_name(nifti_path.name[:-len(".nii.gz")] + ".json")
    sidecar.write_text(json.dumps({"ImageType": image_type}))


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

    def _fake_run(_dicom_dir: Path, nifti_dir: Path) -> str:
        _write_nifti(nifti_dir / "1_series.nii.gz", (3, 4, 5))
        return ""

    with zipfile.ZipFile(zip_path, "w") as zf:
        zf.writestr("dummy.dcm", b"x")

    with patch.object(dicom_fn, "_run_dcm2niix", _fake_run):
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
    """No sidecars: fall back to the spatially largest volume."""
    zip_path = tmp_path / "in.zip"
    out = tmp_path / "out"

    def _fake_run(_dicom_dir: Path, nifti_dir: Path) -> str:
        _write_nifti(nifti_dir / "1_a.nii.gz", (2, 2, 2))
        _write_nifti(nifti_dir / "2_b.nii.gz", (3, 4, 5))
        return ""

    with zipfile.ZipFile(zip_path, "w") as zf:
        zf.writestr("a.dcm", b"x")

    with patch.object(dicom_fn, "_run_dcm2niix", _fake_run):
        result = dicom_fn.convert_dicom(
            str(zip_path),
            str(out),
            max_zip_members=100,
            max_uncompressed_zip_bytes=10_000_000,
        )

    assert nib.load(result).shape == (3, 4, 5)


def test_convert_dicom_prefers_primary_over_larger_localizer(tmp_path):
    """A large localizer must lose to a smaller diagnostic series."""
    zip_path = tmp_path / "in.zip"
    out = tmp_path / "out"

    def _fake_run(_dicom_dir: Path, nifti_dir: Path) -> str:
        localizer = nifti_dir / "1_scout.nii.gz"
        primary = nifti_dir / "2_axial.nii.gz"
        _write_nifti(localizer, (9, 9, 9))
        _write_nifti(primary, (3, 4, 5))
        _write_sidecar(localizer, ["ORIGINAL", "PRIMARY", "LOCALIZER"])
        _write_sidecar(primary, ["ORIGINAL", "PRIMARY", "AXIAL"])
        return ""

    with zipfile.ZipFile(zip_path, "w") as zf:
        zf.writestr("a.dcm", b"x")

    with patch.object(dicom_fn, "_run_dcm2niix", _fake_run):
        result = dicom_fn.convert_dicom(
            str(zip_path),
            str(out),
            max_zip_members=100,
            max_uncompressed_zip_bytes=10_000_000,
        )

    # Smaller axial series wins despite the localizer being spatially larger.
    assert nib.load(result).shape == (3, 4, 5)


def test_convert_dicom_gdcm_fallback_on_undecodable_syntax(tmp_path):
    """dcm2niix yields nothing first pass -> GDCM decompress + retry succeeds."""
    zip_path = tmp_path / "in.zip"
    out = tmp_path / "out"
    calls = {"n": 0}

    def _fake_run(_dicom_dir: Path, nifti_dir: Path) -> str:
        calls["n"] += 1
        if calls["n"] == 1:
            return "Unable to decode ... decompress with gdcmconv"
        _write_nifti(nifti_dir / "1_series.nii.gz", (3, 4, 5))
        return ""

    with zipfile.ZipFile(zip_path, "w") as zf:
        zf.writestr("a.dcm", b"x")

    with patch.object(dicom_fn, "_run_dcm2niix", _fake_run), patch.object(
        dicom_fn, "_gdcm_decompress_dir", return_value=1
    ):
        result = dicom_fn.convert_dicom(
            str(zip_path),
            str(out),
            max_zip_members=100,
            max_uncompressed_zip_bytes=10_000_000,
        )

    assert calls["n"] == 2  # retried after decompression
    assert nib.load(result).shape == (3, 4, 5)


def test_convert_dicom_no_volume_raises(tmp_path):
    """dcm2niix produced nothing -> a clear error including its log tail."""
    zip_path = tmp_path / "in.zip"
    out = tmp_path / "out"

    def _fake_run(_dicom_dir: Path, _nifti_dir: Path) -> str:
        return "Found 1 DICOM file(s), 0 converted"

    with zipfile.ZipFile(zip_path, "w") as zf:
        zf.writestr("a.dcm", b"x")

    with patch.object(dicom_fn, "_run_dcm2niix", _fake_run):
        with pytest.raises(RuntimeError, match="no NIfTI volume"):
            dicom_fn.convert_dicom(
                str(zip_path),
                str(out),
                max_zip_members=100,
                max_uncompressed_zip_bytes=10_000_000,
            )


def test_convert_dicom_converts_loose_file(tmp_path):
    """Non-ZIP path: single file copied into staging then converted."""
    dcm = tmp_path / "one.dcm"
    dcm.write_bytes(b"x")
    out = tmp_path / "out"

    def _fake_run(_dicom_dir: Path, nifti_dir: Path) -> str:
        _write_nifti(nifti_dir / "1_only.nii.gz", (2, 2, 2))
        return ""

    with patch.object(dicom_fn, "_run_dcm2niix", _fake_run):
        result = dicom_fn.convert_dicom(
            str(dcm),
            str(out),
            max_zip_members=100,
            max_uncompressed_zip_bytes=10_000_000,
        )

    assert Path(result).exists()
