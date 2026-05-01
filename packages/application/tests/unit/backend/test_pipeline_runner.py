import asyncio
import pytest
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch
from dataclasses import dataclass, field

from backend.db.models import Study, Blob, FileRecord, PipelineJob
from backend.db.repos.pipeline_job_repo import PipelineJobRepo
from backend.db.repos.study_repo import StudyRepo
from backend.services.storage_service import StorageService
from backend.storage.local_engine import LocalStorageEngine
from backend.workers.pipeline_runner import run_pipeline
from backend.workers.steps.base import StepContext, OutputArtifact, StepResult
from backend.workers.ws_broadcaster import WSBroadcaster


def _setup_db(db_session):
    db_session.add(Study(id="s1", status="processing"))
    db_session.add(Blob(hash="a" * 64, size=100))
    db_session.commit()

    db_session.add(FileRecord(
        id="f1", study_id="s1", kind="nifti_raw",
        rel_path="x", blob_hash="a" * 64, size=100,
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
    pool = MagicMock()

    ctx = StepContext(
        job_id="j1", study_id="s1",
        current_input_path=input_file,
        work_dir=work_dir,
        broadcaster=broadcaster,
        _worker_pool=pool,
    )

    await run_pipeline("j1", steps, ctx, storage_service)

    with session_factory() as db:
        j = PipelineJobRepo(db).get("j1")
        assert j.status == "completed"
        s = StudyRepo(db).get("s1")
        assert s.status == "ready"


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
    pool = MagicMock()

    ctx = StepContext(
        job_id="j1", study_id="s1",
        current_input_path=input_file,
        work_dir=work_dir,
        broadcaster=broadcaster,
        _worker_pool=pool,
    )

    await run_pipeline("j1", steps, ctx, storage_service)

    with session_factory() as db:
        j = PipelineJobRepo(db).get("j1")
        assert j.status == "failed"
        assert j.error == "boom"


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
    pool = MagicMock()

    ctx = StepContext(
        job_id="j1", study_id="s1",
        current_input_path=input_file,
        work_dir=work_dir,
        broadcaster=broadcaster,
        _worker_pool=pool,
    )

    await run_pipeline("j1", steps, ctx, storage_service)
    assert not work_dir.exists()
