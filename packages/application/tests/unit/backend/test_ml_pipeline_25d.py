"""Unit tests for the 2.5D segmentation pipeline pieces."""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import MagicMock

import nibabel as nib
import numpy as np

from backend.workers.subprocesses.ml_pipeline import run_pipeline
from backend.workers.subprocesses.ml_pipeline.core import InferenceContext
from backend.workers.subprocesses.ml_pipeline.predictors import SlidingWindow2DPredictor
from backend.workers.subprocesses.ml_pipeline.transforms import (
    DropLabelsAbove,
    RemoveSmallLabels,
    Reorient,
    ResampleToInputGrid,
    ResampleToVoxelSize,
    SliceContext25D,
    SliceContext25D5Channel,
    ZScorePerChannel,
)

MODELS_DIR = Path(__file__).resolve().parents[4] / "models"
MOBILENETV3_UNET_3CH_CONFIG = (
    MODELS_DIR / "mobilenetv3_unet_3ch" / "exports" / "mobilenetv3_unet_3ch.json"
)


def _ctx_from_xyz(volume_xyz: np.ndarray, affine: np.ndarray) -> InferenceContext:
    """Build a context the way the orchestrator does: (X, Y, Z) -> (1, Z, Y, X)."""
    spacing = np.array(nib.affines.voxel_sizes(affine))[::-1]
    return InferenceContext.from_nifti(volume_xyz.transpose(2, 1, 0), spacing, affine)


def _mock_session(run):
    session = MagicMock()
    inp = MagicMock()
    inp.name = "input"
    session.get_inputs.return_value = [inp]
    session.run = run
    return session


def test_reorient_then_back_to_input_grid_is_exact():
    labels = np.random.default_rng(0).integers(0, 33, size=(7, 9, 11), dtype=np.uint8)
    affine = np.diag([-0.3, 0.3, 0.3, 1.0])  # LAS
    ctx = _ctx_from_xyz(labels, affine)

    Reorient().forward(ctx, axcodes=["R", "P", "I"])
    assert nib.aff2axcodes(ctx.affine) == ("R", "P", "I")

    ResampleToInputGrid().forward(ctx)
    np.testing.assert_array_equal(ctx.data[0], labels.transpose(2, 1, 0))


def test_resample_to_voxel_size_and_back():
    ctx = _ctx_from_xyz(np.ones((10, 12, 14), dtype=np.float32), np.diag([0.6, 0.6, 0.6, 1.0]))

    ResampleToVoxelSize().forward(ctx, voxel_size=0.3)
    np.testing.assert_allclose(ctx.current_spacing, [0.3, 0.3, 0.3])
    assert ctx.data.shape[1:] == (27, 23, 19)

    ResampleToInputGrid().forward(ctx)
    assert ctx.data.shape == (1, 14, 12, 10)


def test_resample_to_voxel_size_skips_matching_scan():
    ctx = _ctx_from_xyz(np.ones((4, 4, 4), dtype=np.float32), np.diag([0.3, 0.3, 0.3, 1.0]))
    before = ctx.data
    ResampleToVoxelSize().forward(ctx, voxel_size=0.3)
    assert ctx.data is before


def test_slice_context_stacks_neighbours_clamped_at_edges():
    volume = np.arange(5, dtype=np.float32)[:, None, None] * np.ones((5, 2, 2), np.float32)
    ctx = InferenceContext.from_nifti(volume, np.ones(3))

    SliceContext25D().forward(ctx, offset=2)

    assert ctx.data.shape == (3, 5, 2, 2)
    np.testing.assert_array_equal(ctx.data[0, :, 0, 0], [0, 0, 0, 1, 2])
    np.testing.assert_array_equal(ctx.data[1, :, 0, 0], [0, 1, 2, 3, 4])
    np.testing.assert_array_equal(ctx.data[2, :, 0, 0], [2, 3, 4, 4, 4])


def test_slice_context_5_channel_stacks_near_and_far_neighbours():
    volume = np.arange(7, dtype=np.float32)[:, None, None] * np.ones((7, 2, 2), np.float32)
    ctx = InferenceContext.from_nifti(volume, np.ones(3))

    SliceContext25D5Channel().forward(ctx, offset=[1, 3])

    assert ctx.data.shape == (5, 7, 2, 2)
    np.testing.assert_array_equal(ctx.data[0, :, 0, 0], [0, 0, 0, 0, 1, 2, 3])
    np.testing.assert_array_equal(ctx.data[1, :, 0, 0], [0, 0, 1, 2, 3, 4, 5])
    np.testing.assert_array_equal(ctx.data[2, :, 0, 0], [0, 1, 2, 3, 4, 5, 6])
    np.testing.assert_array_equal(ctx.data[3, :, 0, 0], [1, 2, 3, 4, 5, 6, 6])
    np.testing.assert_array_equal(ctx.data[4, :, 0, 0], [3, 4, 5, 6, 6, 6, 6])


def test_every_exported_model_has_its_pipeline_config():
    """The worker loads ``MODEL_PATH.with_suffix(".json")``; a missing one silently means no preprocessing."""
    onnx_files = [p for p in MODELS_DIR.glob("*/exports/*.onnx") if p.parts[-3] != "legacy"]
    assert onnx_files
    for onnx in onnx_files:
        assert onnx.with_suffix(".json").exists(), onnx


def test_zscore_per_channel():
    data = np.stack([np.arange(10.0), np.arange(10.0) * 5 + 3]).reshape(2, 10, 1, 1)
    ctx = InferenceContext.from_nifti(data.astype(np.float32), np.ones(3))

    ZScorePerChannel().forward(ctx)

    for channel in ctx.data:
        assert abs(channel.mean()) < 1e-5
        assert abs(channel.std() - 1) < 1e-5


def test_label_cleanup_drops_helper_classes_and_small_teeth():
    labels = np.zeros((1, 10, 10, 10), dtype=np.uint8)
    labels[0, :5, :, :1] = 1    # 50 mm^3 at 1 mm voxels: kept
    labels[0, 9, :1, :] = 2     # 10 mm^3: removed
    labels[0, 7, 5, 5] = 35     # helper class: removed
    ctx = InferenceContext.from_nifti(labels, np.ones(3))

    DropLabelsAbove().forward(ctx, max_label=32)
    RemoveSmallLabels().forward(ctx, min_volume_mm3=40)

    assert set(np.unique(ctx.data)) == {0, 1}
    assert (ctx.data == 1).sum() == 50


def test_sliding_window_2d_stitches_tiles_into_slice_labels():
    rng = np.random.default_rng(1)
    data = rng.standard_normal((3, 5, 20, 30)).astype(np.float32)
    ctx = InferenceContext.from_nifti(data, np.ones(3))
    batch_shapes = []

    def run(_outputs, feed):
        x = feed["input"]
        batch_shapes.append(x.shape)
        # class 1 wherever the centre slice is positive
        return [np.stack([-x[:, 1], x[:, 1]], axis=1)]

    progress = MagicMock()
    labels = SlidingWindow2DPredictor().predict(
        _mock_session(run), ctx, progress, patch_size=[8, 8], batch_size=2
    )

    assert labels.shape == (1, 5, 20, 30) and labels.dtype == np.uint8
    np.testing.assert_array_equal(labels[0], data[1] > 0)
    assert {shape[1:] for shape in batch_shapes} == {(3, 8, 8)}
    assert [c.args[0] for c in progress.put.call_args_list] == [(1, 3), (2, 3), (3, 3)]


def test_mobilenetv3_unet_3ch_config_end_to_end(tmp_path):
    """The shipped config runs end to end and returns labels on the input grid."""
    config = json.loads(MOBILENETV3_UNET_3CH_CONFIG.read_text())
    scan = np.zeros((40, 36, 30), dtype=np.float32)
    scan[10:25, 10:25, 8:20] = 1000.0
    affine = np.diag([-0.6, 0.6, 0.6, 1.0])
    nii = tmp_path / "scan.nii.gz"
    nib.save(nib.Nifti1Image(scan, affine), str(nii))

    def run(_outputs, feed):
        x = feed["input"]
        logits = np.zeros((x.shape[0], 36, *x.shape[2:]), dtype=np.float32)
        logits[:, 0] = 0.5
        logits[:, 5] = x[:, 1]          # tooth 5 where the scan is bright
        logits[:, 34] = x[:, 1] * 0.9   # a helper class that must never win the output
        return [logits]

    mask_path = run_pipeline(str(nii), str(tmp_path / "out"), config, _mock_session(run))

    mask_img = nib.load(mask_path)
    mask = np.asarray(mask_img.dataobj)
    assert mask.shape == scan.shape
    np.testing.assert_allclose(mask_img.affine, affine)
    assert set(np.unique(mask)) == {0, 5}
    tooth, cube = mask == 5, scan > 0
    dice = 2 * (tooth & cube).sum() / (tooth.sum() + cube.sum())
    assert dice > 0.9
