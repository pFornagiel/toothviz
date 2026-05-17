"""Pipeline runner deletes the study on failure when ``study_service`` is wired."""

import pytest
from unittest.mock import AsyncMock, MagicMock

from backend.db.models import Study, FileRecord, PipelineJob
from backend.db.repos.pipeline_job_repo import PipelineJobRepo
from backend.services.storage_service import StorageService
from backend.services.study_service import StudyService
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
async def test_failure_calls_study_delete_when_study_service_provided(
    db_session, session_factory, storage_engine, tmp_path,
):
    _setup_db(db_session)
    storage_service = StorageService(storage_engine, session_factory)
    study_service = MagicMock(spec=StudyService)

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

    await run_pipeline("j1", [BoomStep()], ctx, storage_service, study_service=study_service)

    study_service.delete.assert_called_once_with("s1")


@pytest.mark.asyncio
async def test_failure_broadcasts_before_delete(
    db_session, session_factory, storage_engine, tmp_path,
):
    _setup_db(db_session)
    storage_service = StorageService(storage_engine, session_factory)
    study_service = MagicMock(spec=StudyService)

    call_order: list[str] = []
    broadcaster = AsyncMock(spec=WSBroadcaster)

    async def _track_broadcast(job_id, payload):
        call_order.append(payload.get("event", ""))

    broadcaster.broadcast.side_effect = _track_broadcast

    def _track_delete(_sid: str):
        call_order.append("delete")

    study_service.delete.side_effect = _track_delete

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

    await run_pipeline("j1", [BoomStep()], ctx, storage_service, study_service=study_service)

    assert "pipeline_failed" in call_order
    assert call_order.index("pipeline_failed") < call_order.index("delete")
