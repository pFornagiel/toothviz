"""Integration test fixtures — full app with TestClient."""

import pytest
import pytest_asyncio
from pathlib import Path
from contextlib import asynccontextmanager
from unittest.mock import MagicMock

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from backend.db.models import Base
from backend.db.repos.upload_session_repo import UploadSessionRepo
from backend.exceptions import AppError
from backend.routers import files, studies, uploads, ws
from backend.services.job_pipeline_service import JobPipelineService
from backend.services.storage_service import StorageService
from backend.services.study_service import StudyService
from backend.services.upload_service import UploadService
from backend.storage.local_engine import LocalStorageEngine
from backend.workers.steps.base import StepFactory
from backend.workers.steps.segment_nifti import SegmentNiftiStep
from backend.workers.worker_pool import WorkerPool
from backend.workers.ws_broadcaster import WSBroadcaster


@pytest_asyncio.fixture()
async def integration_app(tmp_path):
    """Build a full FastAPI app with in-memory DB and temp storage."""
    data_root = tmp_path / "data"
    data_root.mkdir()

    db_url = f"sqlite:///{tmp_path / 'test.db'}"
    eng = create_engine(db_url, future=True)

    @event.listens_for(eng, "connect")
    def _pragmas(dbapi_conn, _):
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA foreign_keys=ON")
        cur.close()

    Base.metadata.create_all(eng)
    session_factory = sessionmaker(bind=eng, expire_on_commit=False)

    storage_engine = LocalStorageEngine(data_root)
    storage_service = StorageService(storage_engine, session_factory)
    broadcaster = WSBroadcaster()

    # No real worker pool in integration tests
    pool = MagicMock(spec=WorkerPool)
    step_registry: dict[str, StepFactory] = {
        "segment_nifti": lambda cfg: SegmentNiftiStep(config=cfg),
    }
    job_pipeline_service = JobPipelineService(
        pool, session_factory, storage_service, broadcaster,
        step_registry=step_registry,
    )

    study_service = StudyService(storage_service, job_pipeline_service)
    upload_service = UploadService(storage_service, job_pipeline_service)

    from fastapi.responses import JSONResponse

    app = FastAPI()

    @app.exception_handler(AppError)
    async def _handler(request, exc: AppError):
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})

    app.include_router(studies.router)
    app.include_router(uploads.router)
    app.include_router(files.router)
    app.include_router(ws.router)

    app.state.upload_service = upload_service
    app.state.study_service = study_service
    app.state.job_pipeline_service = job_pipeline_service
    app.state.storage_service = storage_service
    app.state.broadcaster = broadcaster

    return app


@pytest.fixture()
def client(integration_app):
    return TestClient(integration_app)


@pytest.fixture()
def created_study(client):
    """Helper: creates a study and returns the response dict."""
    resp = client.post("/storage/studies", json={"name": "Test Study"})
    assert resp.status_code == 201
    return resp.json()
