import pytest
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

from backend.workers.steps.base import (
    StepContext,
    WORKER_POOL_DICOM,
    WORKER_POOL_SEGMENTATION,
)
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
    dicom_pool = MagicMock()
    seg_pool = MagicMock()

    ctx = StepContext(
        job_id="j1",
        study_id="s1",
        current_input_path=input_file,
        work_dir=work_dir,
        broadcaster=broadcaster,
        worker_pools={
            WORKER_POOL_DICOM: dicom_pool,
            WORKER_POOL_SEGMENTATION: seg_pool,
        },
    )
    return ctx


@pytest.mark.asyncio
async def test_dicom_to_nifti_step_result(tmp_path):
    ctx = _make_ctx(tmp_path)

    async def _fake_run(fn, *args):
        out_dir = Path(args[1])
        out_dir.mkdir(parents=True, exist_ok=True)
        result_path = out_dir / "converted.nii.gz"
        result_path.write_bytes(b"nifti_data")
        return str(result_path)

    dicom_pool = ctx.worker_pools[WORKER_POOL_DICOM]
    seg_pool = ctx.worker_pools[WORKER_POOL_SEGMENTATION]
    dicom_pool.run = AsyncMock(side_effect=_fake_run)

    step = DicomToNiftiStep()
    result = await step.run(ctx)

    assert len(result.artifacts) == 1
    assert result.artifacts[0].kind == "nifti_derived"
    assert result.artifacts[0].purpose == "viewer_volume"
    assert result.next_input_path.name == "converted.nii.gz"
    dicom_pool.run.assert_awaited()
    seg_pool.run.assert_not_called()


@pytest.mark.asyncio
async def test_segment_nifti_step_result(tmp_path):
    ctx = _make_ctx(tmp_path)

    async def _fake_run(fn, *args):
        out_dir = Path(args[1])
        out_dir.mkdir(parents=True, exist_ok=True)
        result_path = out_dir / "segmentation_mask.nii.gz"
        result_path.write_bytes(b"mask_data")
        return str(result_path)

    ctx.worker_pools[WORKER_POOL_SEGMENTATION].run = AsyncMock(side_effect=_fake_run)

    step = SegmentNiftiStep()
    result = await step.run(ctx)

    assert len(result.artifacts) == 1
    assert result.artifacts[0].kind == "segmentation_mask"
    assert result.artifacts[0].purpose == "viewer_overlay"
    assert result.next_input_path == ctx.current_input_path
    ctx.worker_pools[WORKER_POOL_SEGMENTATION].run.assert_awaited()


@pytest.mark.asyncio
async def test_step_broadcasts_progress(tmp_path):
    ctx = _make_ctx(tmp_path)

    async def _fake_run(fn, *args):
        out_dir = Path(args[1])
        out_dir.mkdir(parents=True, exist_ok=True)
        result_path = out_dir / "converted.nii.gz"
        result_path.write_bytes(b"data")
        return str(result_path)

    ctx.worker_pools[WORKER_POOL_DICOM].run = AsyncMock(side_effect=_fake_run)

    step = DicomToNiftiStep()
    await step.run(ctx)

    ctx.broadcaster.broadcast.assert_called_once()
    payload = ctx.broadcaster.broadcast.call_args[0][1]
    assert payload.get("event") == "step_completed"
    assert payload.get("step") == "dicom_to_nifti"


@pytest.mark.asyncio
async def test_step_context_run_in_worker_pool_delegates(tmp_path):
    ctx = _make_ctx(tmp_path)
    dicom_pool = ctx.worker_pools[WORKER_POOL_DICOM]
    seg_pool = ctx.worker_pools[WORKER_POOL_SEGMENTATION]
    dicom_pool.run = AsyncMock(return_value="result")
    seg_pool.run = AsyncMock(return_value="seg")

    def dummy_fn(x):
        return x

    result_d = await ctx.run_in_worker_pool(WORKER_POOL_DICOM, dummy_fn, "arg")
    dicom_pool.run.assert_called_once_with(dummy_fn, "arg")
    assert result_d == "result"

    result_s = await ctx.run_in_worker_pool(WORKER_POOL_SEGMENTATION, dummy_fn, "a")
    seg_pool.run.assert_called_once_with(dummy_fn, "a")
    assert result_s == "seg"


@pytest.mark.asyncio
async def test_step_context_unknown_worker_pool_raises(tmp_path):
    ctx = _make_ctx(tmp_path)
    with pytest.raises(KeyError) as exc_info:
        await ctx.run_in_worker_pool("nonexistent_pool", lambda: None)

    assert "nonexistent_pool" in str(exc_info.value)
    assert "dicom" in str(exc_info.value) or "segmentation" in str(exc_info.value)
