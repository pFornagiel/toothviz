import pytest
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock
from dataclasses import dataclass, field

from backend.workers.steps.base import StepContext, OutputArtifact, StepResult
from backend.workers.steps.dicom_to_nifti import DicomToNiftiStep
from backend.workers.steps.segment_nifti import SegmentNiftiStep
from backend.workers.ws_broadcaster import WSBroadcaster


def _make_ctx(tmp_path, input_file=None):
    if input_file is None:
        input_file = tmp_path / "input.nii.gz"
        input_file.write_bytes(b"fake_nifti")

    work_dir = tmp_path / "work"
    work_dir.mkdir(exist_ok=True)

    broadcaster = AsyncMock(spec=WSBroadcaster)
    pool = MagicMock()

    ctx = StepContext(
        job_id="j1",
        study_id="s1",
        current_input_path=input_file,
        work_dir=work_dir,
        broadcaster=broadcaster,
        _worker_pool=pool,
    )
    return ctx


@pytest.mark.asyncio
async def test_dicom_to_nifti_step_result(tmp_path):
    ctx = _make_ctx(tmp_path)

    nifti_out = tmp_path / "work" / "dicom_output" / "converted.nii.gz"

    async def _fake_run(fn, *args):
        out_dir = Path(args[1])
        out_dir.mkdir(parents=True, exist_ok=True)
        result_path = out_dir / "converted.nii.gz"
        result_path.write_bytes(b"nifti_data")
        return str(result_path)

    ctx._worker_pool.run = AsyncMock(side_effect=_fake_run)

    step = DicomToNiftiStep()
    result = await step.run(ctx)

    assert len(result.artifacts) == 1
    assert result.artifacts[0].kind == "nifti_derived"
    assert result.artifacts[0].purpose == "viewer_volume"
    assert result.next_input_path.name == "converted.nii.gz"


@pytest.mark.asyncio
async def test_segment_nifti_step_result(tmp_path):
    ctx = _make_ctx(tmp_path)

    async def _fake_run(fn, *args):
        out_dir = Path(args[1])
        out_dir.mkdir(parents=True, exist_ok=True)
        result_path = out_dir / "segmentation_mask.nii.gz"
        result_path.write_bytes(b"mask_data")
        return str(result_path)

    ctx._worker_pool.run = AsyncMock(side_effect=_fake_run)

    step = SegmentNiftiStep()
    result = await step.run(ctx)

    assert len(result.artifacts) == 1
    assert result.artifacts[0].kind == "segmentation_mask"
    assert result.artifacts[0].purpose == "viewer_overlay"
    assert result.next_input_path == ctx.current_input_path


@pytest.mark.asyncio
async def test_step_broadcasts_progress(tmp_path):
    ctx = _make_ctx(tmp_path)

    async def _fake_run(fn, *args):
        out_dir = Path(args[1])
        out_dir.mkdir(parents=True, exist_ok=True)
        result_path = out_dir / "converted.nii.gz"
        result_path.write_bytes(b"data")
        return str(result_path)

    ctx._worker_pool.run = AsyncMock(side_effect=_fake_run)

    step = DicomToNiftiStep()
    await step.run(ctx)

    ctx.broadcaster.broadcast.assert_called_once()


@pytest.mark.asyncio
async def test_step_context_run_subprocess_delegates(tmp_path):
    ctx = _make_ctx(tmp_path)
    ctx._worker_pool.run = AsyncMock(return_value="result")

    def dummy_fn(x):
        return x

    result = await ctx.run_subprocess(dummy_fn, "arg")
    ctx._worker_pool.run.assert_called_once_with(dummy_fn, "arg")
    assert result == "result"
