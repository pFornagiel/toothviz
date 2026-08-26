"""Unit tests for modular ONNX segmentation pipeline."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock

import nibabel as nib
import numpy as np
import pytest

from backend.workers.subprocesses import segmentation_fn
from backend.workers.subprocesses.ml_pipeline.core import InferenceContext
from backend.workers.subprocesses.ml_pipeline.transforms import PadToSize, ReversePad

def test_pad_unpad_roundtrip():
    # Test our new pad to size transforms
    data = np.random.randn(1, 10, 11, 12).astype(np.float32)
    ctx = InferenceContext(
        data=data,
        original_spacing=np.array([1.0, 1.0, 1.0]),
        current_spacing=np.array([1.0, 1.0, 1.0]),
        original_shape=data.shape,
    )
    
    pad = PadToSize()
    reverse_pad = ReversePad()
    
    pad.forward(ctx, min_size=[16, 16, 16])
    assert all(s >= 16 for s in ctx.data.shape[1:])
    
    reverse_pad.forward(ctx)
    assert ctx.data.shape == data.shape
    np.testing.assert_allclose(ctx.data, data)


def test_run_segmentation_requires_model(monkeypatch, tmp_path):
    monkeypatch.setattr(segmentation_fn, "_model", None)
    nii = tmp_path / "in.nii.gz"
    img = nib.Nifti1Image(np.zeros((4, 4, 4), np.float32), np.eye(4))
    nib.save(img, str(nii))
    out = tmp_path / "out"
    out.mkdir()
    
    with pytest.raises(RuntimeError, match="not initialized"):
        segmentation_fn.run_segmentation(str(nii), str(out), {})


def test_run_segmentation_rejects_non_3d(monkeypatch, tmp_path):
    mock_session = MagicMock()
    monkeypatch.setattr(segmentation_fn, "_model", mock_session)

    nii = tmp_path / "in.nii.gz"
    img = nib.Nifti1Image(np.zeros((4, 4), np.float32), np.eye(4))
    nib.save(img, str(nii))
    out = tmp_path / "out"
    out.mkdir()
    
    with pytest.raises(ValueError, match="3D"):
        segmentation_fn.run_segmentation(str(nii), str(out), {})


def test_run_segmentation_success(monkeypatch, tmp_path):
    data = np.zeros((16, 16, 16), dtype=np.float32)
    mock_session = MagicMock()
    inp = MagicMock()
    inp.name = "input"
    mock_session.get_inputs.return_value = [inp]

    # Model outputting dummy classes (3 classes)
    prob = np.zeros((3, 16, 16, 16), dtype=np.float32)
    prob[0] = 0.5  # Background
    prob[1, 2:6, 2:6, 2:6] = 0.8
    prob[2, 8:10, 8:10, 8:10] = 0.8

    def _run(*_a, **_k):
        # Return 1xCxXxYxZ
        return [prob[np.newaxis, ...]]

    mock_session.run = _run
    monkeypatch.setattr(segmentation_fn, "_model", mock_session)

    nii = tmp_path / "in.nii.gz"
    img = nib.Nifti1Image(data, np.eye(4))
    img.header.set_zooms((1.0, 1.0, 1.0))
    nib.save(img, str(nii))
    out_dir = tmp_path / "seg_out"
    out_dir.mkdir()

    cfg = {
        "preprocessing": [
            {"name": "Resample", "target_spacing": [1.0, 1.0, 1.0]},
            {"name": "PadToSize", "min_size": [16, 16, 16]},
        ],
        "prediction": {
            "strategy": "sliding_window_3d",
            "params": {
                "patch_size": [16, 16, 16],
                "tile_step_size": 0.5
            }
        },
        "postprocessing": [
            {"name": "ReversePad"},
            {"name": "ReverseResample"},
            {"name": "Argmax"},
        ]
    }

    out_path = segmentation_fn.run_segmentation(str(nii), str(out_dir), cfg)
    assert Path(out_path).exists()
    
    m1 = np.asarray(nib.load(out_path).get_fdata())
    assert m1.shape == data.shape
    # We used argmax so max val should be 2
    assert m1.max() == 2


def test_run_segmentation_success_with_different_config(monkeypatch, tmp_path):
    """Test that we can override the pipeline config and it actually uses it."""
    data = np.zeros((8, 8, 8), dtype=np.float32)
    mock_session = MagicMock()
    inp = MagicMock()
    inp.name = "input"
    mock_session.get_inputs.return_value = [inp]

    # Model outputting dummy classes (3 classes)
    prob = np.zeros((3, 8, 8, 8), dtype=np.float32)
    prob[0] = 0.5
    prob[1, 2:4, 2:4, 2:4] = 0.8

    def _run(output_names, input_feed, **_k):
        # We assert that the patch fed to the model is exactly 8x8x8
        # based on our new config override.
        input_data = input_feed["input"]
        assert input_data.shape == (1, 1, 8, 8, 8)
        return [prob[np.newaxis, ...]]

    mock_session.run = _run
    monkeypatch.setattr(segmentation_fn, "_model", mock_session)

    nii = tmp_path / "in.nii.gz"
    img = nib.Nifti1Image(data, np.eye(4))
    img.header.set_zooms((1.0, 1.0, 1.0))
    nib.save(img, str(nii))
    out_dir = tmp_path / "seg_out_diff"
    out_dir.mkdir()

    cfg = {
        "preprocessing": [
            {"name": "Resample", "target_spacing": [1.0, 1.0, 1.0]},
            {"name": "PadToSize", "min_size": [8, 8, 8]},
        ],
        "prediction": {
            "strategy": "sliding_window_3d",
            "params": {
                "patch_size": [8, 8, 8],
                "tile_step_size": 1.0
            }
        },
        "postprocessing": [
            {"name": "ReversePad"},
            {"name": "ReverseResample"},
            {"name": "Argmax"},
        ]
    }

    out_path = segmentation_fn.run_segmentation(str(nii), str(out_dir), cfg)
    assert Path(out_path).exists()
    
    m1 = np.asarray(nib.load(out_path).get_fdata())
    assert m1.shape == data.shape
    assert m1.max() == 1
