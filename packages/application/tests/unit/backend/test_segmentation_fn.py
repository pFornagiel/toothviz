"""Unit tests for ONNX segmentation subprocess helpers."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock

import nibabel as nib
import numpy as np
import pytest

from backend.workers.subprocesses import segmentation_fn


def test_pad_unpad_roundtrip():
    data = np.random.randn(10, 11, 12).astype(np.float32)
    padded, pads = segmentation_fn._pad_to_multiple(data, 16)
    assert all(s % 16 == 0 for s in padded.shape)
    back = segmentation_fn._unpad(padded, pads)
    assert back.shape == data.shape
    np.testing.assert_allclose(back, data)


def test_run_segmentation_requires_model(monkeypatch, tmp_path):
    monkeypatch.setattr(segmentation_fn, "_model", None)
    nii = tmp_path / "in.nii.gz"
    img = nib.Nifti1Image(np.zeros((4, 4, 4), np.float32), np.eye(4))
    nib.save(img, str(nii))
    out = tmp_path / "out"
    out.mkdir()
    with pytest.raises(RuntimeError, match="not initialized"):
        segmentation_fn.run_segmentation(str(nii), str(out), 0.5, 16)


def test_run_segmentation_rejects_non_3d(monkeypatch, tmp_path):
    mock_session = MagicMock()
    monkeypatch.setattr(segmentation_fn, "_model", mock_session)

    nii = tmp_path / "in.nii.gz"
    img = nib.Nifti1Image(np.zeros((4, 4), np.float32), np.eye(4))
    nib.save(img, str(nii))
    out = tmp_path / "out"
    out.mkdir()
    with pytest.raises(ValueError, match="3D"):
        segmentation_fn.run_segmentation(str(nii), str(out), 0.5, 16)


def test_predict_validates_output_spatial_shape(monkeypatch):
    data = np.zeros((8, 8, 8), dtype=np.float32)
    mock_session = MagicMock()
    inp = MagicMock()
    inp.name = "input"
    mock_session.get_inputs.return_value = [inp]

    def _run(*_a, **_k):
        return [np.zeros((1, 1, 7, 8, 8), dtype=np.float32)]

    mock_session.run = _run
    monkeypatch.setattr(segmentation_fn, "_model", mock_session)

    with pytest.raises(ValueError, match="does not match"):
        segmentation_fn._predict(data, threshold=0.5, pad_multiple=16)


def test_threshold_affects_binary_mask(monkeypatch, tmp_path):
    data = np.zeros((16, 16, 16), dtype=np.float32)
    mock_session = MagicMock()
    inp = MagicMock()
    inp.name = "input"
    mock_session.get_inputs.return_value = [inp]

    prob = np.zeros((16, 16, 16), dtype=np.float32)
    prob[2:6, 2:6, 2:6] = 0.8
    prob[8:10, 8:10, 8:10] = 0.3

    def _run(*_a, **_k):
        return [prob[np.newaxis, np.newaxis, ...]]

    mock_session.run = _run
    monkeypatch.setattr(segmentation_fn, "_model", mock_session)

    nii = tmp_path / "in.nii.gz"
    img = nib.Nifti1Image(data, np.eye(4))
    nib.save(img, str(nii))
    out_dir = tmp_path / "seg_out"
    out_dir.mkdir()

    high = segmentation_fn.run_segmentation(str(nii), str(out_dir / "h"), 0.5, 16)
    low = segmentation_fn.run_segmentation(str(nii), str(out_dir / "l"), 0.25, 16)

    m1 = np.asarray(nib.load(high).get_fdata())
    m2 = np.asarray(nib.load(low).get_fdata())
    assert m1.sum() < m2.sum()
