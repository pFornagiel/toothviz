import pytest
import pytest_asyncio
from unittest.mock import AsyncMock, MagicMock, patch

from backend.db.models import Study, Blob, FileRecord, PipelineJob
from backend.db.repos.pipeline_job_repo import PipelineJobRepo
from backend.services.job_pipeline_service import JobPipelineService
from backend.services.storage_service import StorageService
from backend.workers.steps.base import StepFactory
from backend.workers.steps.dicom_to_nifti import DicomToNiftiStep
from backend.workers.steps.segment_nifti import SegmentNiftiStep
from backend.workers.worker_pool import WorkerPool
from backend.workers.ws_broadcaster import WSBroadcaster


def _setup_db(db_session, kind="nifti_raw"):
    db_session.add(Study(id="s1", status="created"))
    db_session.add(Blob(hash="a" * 64, size=100))
    rec = FileRecord(
        id="f1", study_id="s1", kind=kind,
        rel_path="x", blob_hash="a" * 64, size=100,
    )
    db_session.add(rec)
    db_session.commit()
    return rec


@pytest_asyncio.fixture()
async def jps(session_factory, storage_engine, tmp_data_root):
    storage_service = StorageService(storage_engine, session_factory)
    broadcaster = AsyncMock(spec=WSBroadcaster)
    pool = MagicMock(spec=WorkerPool)
    step_registry: dict[str, StepFactory] = {
        "segment_nifti": lambda cfg: SegmentNiftiStep(config=cfg),
    }
    return JobPipelineService(
        pool, session_factory, storage_service, broadcaster,
        step_registry=step_registry,
    )


@pytest.mark.asyncio
async def test_dispatch_dicom_zip_prepends_auto_step(db_session, jps):
    rec = _setup_db(db_session, kind="dicom_zip")

    with patch("backend.services.job_pipeline_service.asyncio") as mock_asyncio:
        mock_task = MagicMock()
        mock_asyncio.create_task.return_value = mock_task
        mock_task.add_done_callback = MagicMock()

        job_id = jps.dispatch(rec, [], db_session)

    assert job_id is not None
    job = PipelineJobRepo(db_session).get(job_id)
    assert "dicom_to_nifti" in job.steps


@pytest.mark.asyncio
async def test_dispatch_nifti_raw_with_segment(db_session, jps):
    rec = _setup_db(db_session, kind="nifti_raw")

    with patch("backend.services.job_pipeline_service.asyncio") as mock_asyncio:
        mock_task = MagicMock()
        mock_asyncio.create_task.return_value = mock_task
        mock_task.add_done_callback = MagicMock()

        job_id = jps.dispatch(
            rec,
            [{"name": "segment_nifti", "config": {}}],
            db_session,
        )

    assert job_id is not None
    job = PipelineJobRepo(db_session).get(job_id)
    assert job.steps == ["segment_nifti"]


@pytest.mark.asyncio
async def test_dispatch_dicom_with_segment(db_session, jps):
    rec = _setup_db(db_session, kind="dicom_zip")

    with patch("backend.services.job_pipeline_service.asyncio") as mock_asyncio:
        mock_task = MagicMock()
        mock_asyncio.create_task.return_value = mock_task
        mock_task.add_done_callback = MagicMock()

        job_id = jps.dispatch(
            rec,
            [{"name": "segment_nifti", "config": {}}],
            db_session,
        )

    job = PipelineJobRepo(db_session).get(job_id)
    assert job.steps == ["dicom_to_nifti", "segment_nifti"]


@pytest.mark.asyncio
async def test_dispatch_no_steps_returns_none(db_session, jps):
    rec = _setup_db(db_session, kind="nifti_raw")

    job_id = jps.dispatch(rec, [], db_session)
    assert job_id is None
