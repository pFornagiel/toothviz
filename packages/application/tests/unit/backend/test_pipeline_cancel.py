"""JobPipelineService.cancel_for_study marks jobs cancelled without deleting the study."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio

from backend.db.models import FileRecord, PipelineJob, Study
from backend.db.repos.pipeline_job_repo import PipelineJobRepo
from backend.services.job_pipeline_service import JobPipelineService
from backend.workers.steps.stub import StubStep


def _setup(db_session, status: str = "running"):
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
            error=None,
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

    broadcaster = MagicMock()
    broadcaster.broadcast = AsyncMock()

    dicom_pool = MagicMock()
    seg_pool = MagicMock()

    return JobPipelineService(
        worker_pools={"dicom": dicom_pool, "segmentation": seg_pool},
        session_factory=session_factory,
        storage_service=storage,
        broadcaster=broadcaster,
        step_registry={"stub": lambda cfg: StubStep()},
    )


@pytest.mark.asyncio
async def test_cancel_created_job(db_session, pipeline_service):
    _setup(db_session, status="created")
    with pipeline_service._session_factory() as db:
        job = pipeline_service.cancel_for_study("s1", db)
        assert job.status == "cancelled"
        assert job.source_file_id == "f1"
    pipeline_service._worker_pools["segmentation"].force_stop.assert_not_called()
    pipeline_service._worker_pools["dicom"].force_stop.assert_not_called()


@pytest.mark.asyncio
async def test_cancel_running_without_future_marks_db(db_session, pipeline_service):
    """Stale running row (not in `_running`) is cancelled and broadcast; no pool kill."""
    _setup(db_session, status="running")
    with pipeline_service._session_factory() as db:
        job = pipeline_service.cancel_for_study("s1", db)
        assert job.status == "cancelled"
    pipeline_service._broadcaster.broadcast.assert_called()
    pipeline_service._worker_pools["segmentation"].force_stop.assert_not_called()
    pipeline_service._worker_pools["dicom"].force_stop.assert_not_called()


@pytest.mark.asyncio
async def test_cancel_idempotent(db_session, pipeline_service):
    _setup(db_session, status="cancelled")
    with pipeline_service._session_factory() as db:
        job = pipeline_service.cancel_for_study("s1", db)
        assert job.status == "cancelled"
    pipeline_service._worker_pools["segmentation"].force_stop.assert_not_called()


@pytest.mark.asyncio
async def test_cancel_completed_is_noop(db_session, pipeline_service):
    """Late cancel after completion returns the job without error or kill."""
    _setup(db_session, status="completed")
    with pipeline_service._session_factory() as db:
        job = pipeline_service.cancel_for_study("s1", db)
        assert job.status == "completed"
    pipeline_service._worker_pools["segmentation"].force_stop.assert_not_called()


@pytest.mark.asyncio
async def test_cancel_failed_is_noop(db_session, pipeline_service):
    _setup(db_session, status="failed")
    with pipeline_service._session_factory() as db:
        job = pipeline_service.cancel_for_study("s1", db)
        assert job.status == "failed"
    pipeline_service._worker_pools["segmentation"].force_stop.assert_not_called()


@pytest.mark.asyncio
async def test_cancel_ready_is_noop(db_session, pipeline_service):
    """Studies that skipped the pipeline (status ready) must soft-succeed."""
    _setup(db_session, status="ready")
    with pipeline_service._session_factory() as db:
        job = pipeline_service.cancel_for_study("s1", db)
        assert job.status == "ready"
    pipeline_service._worker_pools["segmentation"].force_stop.assert_not_called()
    pipeline_service._broadcaster.broadcast.assert_not_called()


@pytest.mark.asyncio
async def test_cancel_with_running_future_force_stops_pools(db_session, pipeline_service):
    _setup(db_session, status="running")
    mock_future = MagicMock()
    mock_future.cancel.return_value = True
    pipeline_service._running["j1"] = mock_future

    with pipeline_service._session_factory() as db:
        job = pipeline_service.cancel_for_study("s1", db)
        assert job.status == "cancelled"

    mock_future.cancel.assert_called_once()
    pipeline_service._worker_pools["segmentation"].force_stop.assert_called()
    pipeline_service._worker_pools["dicom"].force_stop.assert_called()
    pipeline_service._broadcaster.broadcast.assert_not_called()


@pytest.mark.asyncio
async def test_cancel_skips_force_stop_when_sibling_pipeline_running(
    db_session, pipeline_service,
):
    """Shared pools must not be killed while another study still needs them."""
    _setup(db_session, status="running")
    mock_future = MagicMock()
    mock_future.cancel.return_value = True
    pipeline_service._running["j1"] = mock_future
    pipeline_service._running["j2"] = MagicMock()

    with pipeline_service._session_factory() as db:
        job = pipeline_service.cancel_for_study("s1", db)
        assert job.status == "cancelled"

    mock_future.cancel.assert_called_once()
    pipeline_service._worker_pools["segmentation"].force_stop.assert_not_called()
    pipeline_service._worker_pools["dicom"].force_stop.assert_not_called()


@pytest.mark.asyncio
async def test_cancel_lost_race_to_completed_does_not_overwrite(
    db_session, pipeline_service,
):
    """If completed wins between read and write, cancel must leave completed intact."""
    _setup(db_session, status="running")
    mock_future = MagicMock()
    mock_future.cancel.return_value = True
    pipeline_service._running["j1"] = mock_future

    original = PipelineJobRepo.update_status_if

    def complete_then_attempt(self, job_id, new_status, *, from_statuses, error=None):
        if new_status == "cancelled":
            self.set_status(job_id, "completed")
        return original(
            self, job_id, new_status, from_statuses=from_statuses, error=error
        )

    with patch.object(PipelineJobRepo, "update_status_if", complete_then_attempt):
        with pipeline_service._session_factory() as db:
            job = pipeline_service.cancel_for_study("s1", db)
            assert job.status == "completed"

    mock_future.cancel.assert_not_called()
    pipeline_service._worker_pools["segmentation"].force_stop.assert_not_called()
    pipeline_service._worker_pools["dicom"].force_stop.assert_not_called()
