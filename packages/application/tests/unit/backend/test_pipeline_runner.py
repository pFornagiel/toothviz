import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from backend.db.models import Study, FileRecord, PipelineJob
from backend.db.repos.pipeline_job_repo import PipelineJobRepo
from backend.services.storage_service import StorageService
from backend.workers.pipeline_runner import run_pipeline
from backend.workers.steps.base import (
    StepContext,
    OutputArtifact,
    StepResult,
    WORKER_POOL_DICOM,
    WORKER_POOL_SEGMENTATION,
)
from backend.workers.ws_broadcaster import WSBroadcaster


def _setup_db(db_session):
    db_session.add(Study(id="s1"))
    db_session.commit()

    db_session.add(FileRecord(
        id="f1", study_id="s1", kind="nifti_raw",
        display_name="input.nii", blob_hash="a" * 64, size=100,
    ))
    db_session.commit()

    job = PipelineJob(
        id="j1", study_id="s1", source_file_id="f1",
        steps=["step1"], status="queued",
    )
    db_session.add(job)
    db_session.commit()
    return job


class MockStep:
    def __init__(self, name, artifacts=None, error=None):
        self.name = name
        self._artifacts = artifacts or []
        self._error = error

    async def run(self, ctx):
        if self._error:
            raise self._error
        return StepResult(
            next_input_path=ctx.current_input_path,
            artifacts=self._artifacts,
        )


def _make_ctx(tmp_path, input_file, work_dir, broadcaster, dicom_pool, seg_pool):
    return StepContext(
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


@pytest.mark.asyncio
async def test_run_pipeline_success(
    db_session, session_factory, storage_engine, tmp_path,
):
    job = _setup_db(db_session)
    storage_service = StorageService(storage_engine, session_factory)

    artifact_file = tmp_path / "mask.nii"
    artifact_file.write_bytes(b"mask_content")

    steps = [
        MockStep("step1", artifacts=[
            OutputArtifact(path=artifact_file, kind="segmentation_mask", purpose="viewer_overlay"),
        ]),
    ]

    input_file = tmp_path / "input.nii"
    input_file.write_bytes(b"input_data")
    work_dir = tmp_path / "work"

    broadcaster = AsyncMock(spec=WSBroadcaster)
    dicom_pool = MagicMock()
    seg_pool = MagicMock()

    ctx = _make_ctx(tmp_path, input_file, work_dir, broadcaster, dicom_pool, seg_pool)

    await run_pipeline("j1", steps, ctx, storage_service)

    with session_factory() as db:
        j = PipelineJobRepo(db).get("j1")
        assert j.status == "completed"

    completed_calls = [
        call
        for call in broadcaster.broadcast.await_args_list
        if call.args[1].get("event") == "pipeline_completed"
    ]
    assert len(completed_calls) == 1
    payload = completed_calls[0].args[1]
    assert payload["status"] == "completed"
    assert payload["overlay_file_id"] is not None
    assert payload.get("volume_file_id") is None


@pytest.mark.asyncio
async def test_run_pipeline_failure(
    db_session, session_factory, storage_engine, tmp_path,
):
    job = _setup_db(db_session)
    storage_service = StorageService(storage_engine, session_factory)

    steps = [MockStep("bad_step", error=RuntimeError("boom"))]

    input_file = tmp_path / "input.nii"
    input_file.write_bytes(b"data")
    work_dir = tmp_path / "work"

    broadcaster = AsyncMock(spec=WSBroadcaster)
    dicom_pool = MagicMock()
    seg_pool = MagicMock()

    ctx = _make_ctx(tmp_path, input_file, work_dir, broadcaster, dicom_pool, seg_pool)

    await run_pipeline("j1", steps, ctx, storage_service)

    with session_factory() as db:
        j = PipelineJobRepo(db).get("j1")
        assert j.status == "failed"
        assert "bad_step" in (j.error or "")


@pytest.mark.asyncio
async def test_run_pipeline_stores_partial_artifacts_on_later_failure(
    db_session, session_factory, storage_engine, tmp_path,
):
    _setup_db(db_session)
    storage_service = StorageService(storage_engine, session_factory)

    ok_artifact = tmp_path / "would_store.nii"
    ok_artifact.write_bytes(b"x")

    steps = [
        MockStep("good", artifacts=[
            OutputArtifact(path=ok_artifact, kind="nifti_derived", purpose="viewer_volume"),
        ]),
        MockStep("bad", error=RuntimeError("seg failed")),
    ]

    input_file = tmp_path / "input.nii"
    input_file.write_bytes(b"data")
    work_dir = tmp_path / "work"

    broadcaster = AsyncMock(spec=WSBroadcaster)
    dicom_pool = MagicMock()
    seg_pool = MagicMock()

    ctx = _make_ctx(tmp_path, input_file, work_dir, broadcaster, dicom_pool, seg_pool)

    with patch.object(storage_service, "store_derived") as mock_store:
        await run_pipeline("j1", steps, ctx, storage_service)
        mock_store.assert_called_once()

    with session_factory() as db:
        j = PipelineJobRepo(db).get("j1")
        assert j.status == "failed"


@pytest.mark.asyncio
async def test_step_completed_broadcasts_volume_file_id(
    db_session, session_factory, storage_engine, tmp_path,
):
    _setup_db(db_session)
    storage_service = StorageService(storage_engine, session_factory)

    volume_artifact = tmp_path / "volume.nii"
    volume_artifact.write_bytes(b"vol")

    steps = [
        MockStep("dicom_to_nifti", artifacts=[
            OutputArtifact(path=volume_artifact, kind="nifti_derived", purpose="viewer_volume"),
        ]),
        MockStep("segment_nifti"),
    ]

    input_file = tmp_path / "input.nii"
    input_file.write_bytes(b"data")
    work_dir = tmp_path / "work"

    broadcaster = AsyncMock(spec=WSBroadcaster)
    dicom_pool = MagicMock()
    seg_pool = MagicMock()

    ctx = _make_ctx(tmp_path, input_file, work_dir, broadcaster, dicom_pool, seg_pool)

    await run_pipeline("j1", steps, ctx, storage_service)

    completed_calls = [
        call
        for call in broadcaster.broadcast.await_args_list
        if call.args[1].get("event") == "step_completed"
    ]
    assert completed_calls[0].args[1]["volume_file_id"] is not None
    assert "volume_file_id" not in completed_calls[1].args[1]


@pytest.mark.asyncio
async def test_run_pipeline_duplicate_purpose_fails(
    db_session, session_factory, storage_engine, tmp_path,
):
    _setup_db(db_session)
    storage_service = StorageService(storage_engine, session_factory)

    a1 = tmp_path / "a.nii"
    a2 = tmp_path / "b.nii"
    a1.write_bytes(b"a")
    a2.write_bytes(b"b")

    steps = [
        MockStep("step1", artifacts=[
            OutputArtifact(path=a1, kind="nifti_derived", purpose="viewer_volume"),
            OutputArtifact(path=a2, kind="segmentation_mask", purpose="viewer_volume"),
        ]),
    ]

    input_file = tmp_path / "input.nii"
    input_file.write_bytes(b"data")
    work_dir = tmp_path / "work"

    broadcaster = AsyncMock(spec=WSBroadcaster)
    dicom_pool = MagicMock()
    seg_pool = MagicMock()

    ctx = _make_ctx(tmp_path, input_file, work_dir, broadcaster, dicom_pool, seg_pool)

    with patch.object(storage_service, "store_derived") as mock_store:
        await run_pipeline("j1", steps, ctx, storage_service)
        mock_store.assert_not_called()

    with session_factory() as db:
        j = PipelineJobRepo(db).get("j1")
        assert j.status == "failed"
        assert j.error is not None
        assert "Duplicate viewer purpose" in j.error


@pytest.mark.asyncio
async def test_run_pipeline_cleans_work_dir(
    db_session, session_factory, storage_engine, tmp_path,
):
    job = _setup_db(db_session)
    storage_service = StorageService(storage_engine, session_factory)

    steps = [MockStep("ok")]
    input_file = tmp_path / "input.nii"
    input_file.write_bytes(b"data")
    work_dir = tmp_path / "work"

    broadcaster = AsyncMock(spec=WSBroadcaster)
    dicom_pool = MagicMock()
    seg_pool = MagicMock()

    ctx = _make_ctx(tmp_path, input_file, work_dir, broadcaster, dicom_pool, seg_pool)

    await run_pipeline("j1", steps, ctx, storage_service)
    assert not work_dir.exists()
