"""Pipeline runner keeps the study row on failure (job marked failed, study retained)."""

import pytest
from unittest.mock import AsyncMock, MagicMock

from backend.db.models import Study, FileRecord, PipelineJob
from backend.db.repos.pipeline_job_repo import PipelineJobRepo
from backend.db.repos.study_repo import StudyRepo
from backend.services.storage_service import StorageService
from backend.workers.pipeline_runner import run_pipeline
from backend.workers.steps.base import StepContext, WORKER_POOL_DICOM, WORKER_POOL_SEGMENTATION
from backend.workers.ws_broadcaster import WSBroadcaster


class BoomStep:
    name = "boom"

    async def run(self, ctx):
        raise RuntimeError("step boom")


def _setup_db(db_session):
    db_session.add(Study(id="s1"))
    db_session.commit()
    db_session.add(FileRecord(
        id="f1", study_id="s1", kind="nifti_raw",
        display_name="input.nii", blob_hash="a" * 64, size=100,
    ))
    db_session.commit()
    db_session.add(PipelineJob(
        id="j1", study_id="s1", source_file_id="f1",
        steps=["boom"], status="queued",
    ))
    db_session.commit()


@pytest.mark.asyncio
async def test_failure_keeps_study_and_marks_job_failed(
    db_session, session_factory, storage_engine, tmp_path,
):
    _setup_db(db_session)
    storage_service = StorageService(storage_engine, session_factory)

    input_file = tmp_path / "input.nii"
    input_file.write_bytes(b"data")
    work_dir = tmp_path / "work"
    ctx = StepContext(
        job_id="j1",
        study_id="s1",
        current_input_path=input_file,
        work_dir=work_dir,
        broadcaster=AsyncMock(spec=WSBroadcaster),
        worker_pools={
            WORKER_POOL_DICOM: MagicMock(),
            WORKER_POOL_SEGMENTATION: MagicMock(),
        },
    )

    await run_pipeline("j1", [BoomStep()], ctx, storage_service)

    with session_factory() as db:
        job = PipelineJobRepo(db).get("j1")
        assert job.status == "failed"
        assert job.error is not None
        assert StudyRepo(db).get("s1") is not None


@pytest.mark.asyncio
async def test_failure_broadcasts_pipeline_failed(
    db_session, session_factory, storage_engine, tmp_path,
):
    _setup_db(db_session)
    storage_service = StorageService(storage_engine, session_factory)

    broadcaster = AsyncMock(spec=WSBroadcaster)

    input_file = tmp_path / "input.nii"
    input_file.write_bytes(b"data")
    work_dir = tmp_path / "work"
    ctx = StepContext(
        job_id="j1",
        study_id="s1",
        current_input_path=input_file,
        work_dir=work_dir,
        broadcaster=broadcaster,
        worker_pools={
            WORKER_POOL_DICOM: MagicMock(),
            WORKER_POOL_SEGMENTATION: MagicMock(),
        },
    )

    await run_pipeline("j1", [BoomStep()], ctx, storage_service)

    failed_calls = [
        call
        for call in broadcaster.broadcast.await_args_list
        if call.args[1].get("event") == "pipeline_failed"
    ]
    assert len(failed_calls) == 1
    assert failed_calls[0].args[1]["status"] == "failed"
