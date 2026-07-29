"""JobPipelineService.retry re-queues failed/cancelled studies with a source file."""

from unittest.mock import MagicMock, patch

import pytest
import pytest_asyncio

from backend.db.models import FileRecord, PipelineJob, Study
from backend.db.repos.pipeline_job_repo import PipelineJobRepo
from backend.exceptions import ConflictError, ValidationError
from backend.services.job_pipeline_service import JobPipelineService
from backend.workers.steps.stub import StubStep


def _setup(db_session, status: str = "failed"):
    db_session.add(Study(id="s1", name="Study"))
    db_session.commit()
    db_session.add(
        FileRecord(
            id="f1",
            study_id="s1",
            kind="nifti_raw",
            display_name="input.nii",
            blob_hash="a" * 64,
            size=100,
            viewer_purpose="viewer_volume",
        )
    )
    db_session.commit()
    db_session.add(
        PipelineJob(
            id="j1",
            study_id="s1",
            source_file_id="f1",
            steps=["stub"],
            status=status,
            error="boom" if status == "failed" else None,
        )
    )
    db_session.commit()


@pytest_asyncio.fixture()
async def pipeline_service(session_factory, storage_engine, tmp_path):
    engine = MagicMock()
    engine.get_study_file_path.return_value = tmp_path / "input.nii"
    engine.get_job_workspace_dir.return_value = tmp_path / "work"
    (tmp_path / "input.nii").write_bytes(b"x")

    storage = MagicMock()
    storage.engine = engine
    storage.session_factory = session_factory

    return JobPipelineService(
        worker_pools={"dicom": MagicMock(), "segmentation": MagicMock()},
        session_factory=session_factory,
        storage_service=storage,
        broadcaster=MagicMock(),
        step_registry={"stub": lambda cfg: StubStep()},
    )


@pytest.mark.asyncio
async def test_retry_preserves_source_viewer_volume(db_session, session_factory, pipeline_service):
    """nifti_raw source keeps viewer_volume so preview + final volume survive retry."""
    _setup(db_session, status="failed")
    # Stale derived overlay from the failed run (should be cleared).
    db_session.add(
        FileRecord(
            id="overlay-old",
            study_id="s1",
            kind="segmentation_mask",
            display_name="mask.nii",
            blob_hash="b" * 64,
            size=50,
            viewer_purpose="viewer_overlay",
        )
    )
    db_session.commit()

    with patch(
        "backend.services.job_pipeline_service.asyncio.run_coroutine_threadsafe"
    ) as schedule:
        schedule.return_value = MagicMock()
        with session_factory() as db:
            pipeline_service.retry("s1", db)
            source = db.get(FileRecord, "f1")
            assert source is not None
            assert source.viewer_purpose == "viewer_volume"
            old_overlay = db.get(FileRecord, "overlay-old")
            assert old_overlay is not None
            assert old_overlay.viewer_purpose is None


@pytest.mark.asyncio
async def test_retry_failed_job(db_session, session_factory, pipeline_service):
    _setup(db_session, status="failed")

    with patch(
        "backend.services.job_pipeline_service.asyncio.run_coroutine_threadsafe"
    ) as schedule:
        future = MagicMock()
        schedule.return_value = future
        with session_factory() as db:
            job_id = pipeline_service.retry("s1", db)
            assert job_id == "j1"
            job = PipelineJobRepo(db).get("j1")
            assert job.status == "queued"
            assert job.error is None
        schedule.assert_called_once()
        future.add_done_callback.assert_called_once()


@pytest.mark.asyncio
async def test_retry_rejects_running_job(db_session, session_factory, pipeline_service):
    _setup(db_session, status="running")
    with session_factory() as db:
        with pytest.raises(ConflictError):
            pipeline_service.retry("s1", db)


@pytest.mark.asyncio
async def test_retry_rejects_completed_job(db_session, session_factory, pipeline_service):
    _setup(db_session, status="completed")
    with session_factory() as db:
        with pytest.raises(ValidationError):
            pipeline_service.retry("s1", db)