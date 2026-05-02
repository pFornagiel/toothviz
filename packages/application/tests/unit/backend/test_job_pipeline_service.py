import pytest
import pytest_asyncio
from unittest.mock import AsyncMock, MagicMock, patch

from backend.db.models import Study, FileRecord
from backend.db.repos.pipeline_job_repo import PipelineJobRepo
from backend.exceptions import ConflictError
from backend.services.job_pipeline_service import JobPipelineService
from backend.services.storage_service import StorageService
from backend.workers.steps.base import StepFactory
from backend.workers.steps.segment_nifti import SegmentNiftiStep
from backend.workers.steps.configs import SegmentNiftiStepConfig
from backend.workers.worker_pool import WorkerPool
from backend.workers.ws_broadcaster import WSBroadcaster


def _setup_db(db_session, kind="nifti_raw"):
    db_session.add(Study(id="s1"))
    rec = FileRecord(
        id="f1", study_id="s1", kind=kind,
        display_name="vol.nii", blob_hash="a" * 64, size=100,
    )
    db_session.add(rec)
    db_session.commit()
    PipelineJobRepo(db_session).create_for_study("s1")
    db_session.commit()
    return rec


@pytest_asyncio.fixture()
async def jps(session_factory, storage_engine, tmp_data_root):
    storage_service = StorageService(storage_engine, session_factory)
    broadcaster = AsyncMock(spec=WSBroadcaster)
    dicom_pool = MagicMock(spec=WorkerPool)
    seg_pool = MagicMock(spec=WorkerPool)
    step_registry: dict[str, StepFactory] = {
        "segment_nifti": lambda cfg: SegmentNiftiStep(
            config=SegmentNiftiStepConfig.from_mapping(cfg),
        ),
    }
    worker_pools = {
        "dicom": dicom_pool,
        "segmentation": seg_pool,
    }
    return JobPipelineService(
        worker_pools,
        session_factory,
        storage_service,
        broadcaster,
        step_registry=step_registry,
    )


@pytest.mark.asyncio
async def test_dispatch_dicom_zip_prepends_auto_step(db_session, jps):
    rec = _setup_db(db_session, kind="dicom_zip")

    with patch("backend.services.job_pipeline_service.asyncio.run_coroutine_threadsafe") as mock_rcf:
        fut = MagicMock()
        fut.add_done_callback = MagicMock()
        mock_rcf.return_value = fut

        job_id = jps.dispatch(rec, [], db_session)

    assert job_id is not None
    job = PipelineJobRepo(db_session).get(job_id)
    assert "dicom_to_nifti" in job.steps


@pytest.mark.asyncio
async def test_dispatch_nifti_raw_with_segment(db_session, jps):
    rec = _setup_db(db_session, kind="nifti_raw")

    with patch("backend.services.job_pipeline_service.asyncio.run_coroutine_threadsafe") as mock_rcf:
        fut = MagicMock()
        fut.add_done_callback = MagicMock()
        mock_rcf.return_value = fut

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

    with patch("backend.services.job_pipeline_service.asyncio.run_coroutine_threadsafe") as mock_rcf:
        fut = MagicMock()
        fut.add_done_callback = MagicMock()
        mock_rcf.return_value = fut

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


@pytest.mark.asyncio
async def test_dispatch_conflict_when_job_active(db_session, jps):
    rec1 = _setup_db(db_session, kind="dicom_zip")
    with patch("backend.services.job_pipeline_service.asyncio.run_coroutine_threadsafe") as mock_rcf:
        fut = MagicMock()
        fut.add_done_callback = MagicMock()
        mock_rcf.return_value = fut
        jps.dispatch(rec1, [], db_session)

    rec2 = FileRecord(
        id="f2",
        study_id="s1",
        kind="dicom_zip",
        display_name="vol2.zip",
        blob_hash="b" * 64,
        size=100,
    )
    db_session.add(rec2)
    db_session.commit()

    with pytest.raises(ConflictError):
        jps.dispatch(rec2, [], db_session)
