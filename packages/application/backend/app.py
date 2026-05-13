from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from backend.logging import setup_logging
setup_logging("app")

from backend import config
from backend.db.models import Base
from backend.db.repos.upload_session_repo import UploadSessionRepo
from backend.db.session import SessionLocal, engine
from backend.exceptions import AppError
from backend.routers import files, studies, uploads, ws
from backend.services.job_pipeline_service import JobPipelineService
from backend.services.storage_service import StorageService
from backend.services.study_service import StudyService
from backend.services.upload_service import UploadService
from backend.storage.local_engine import LocalStorageEngine
from backend.workers.steps.base import StepFactory
from backend.workers.steps.segment_nifti import SegmentNiftiStep
from backend.workers.steps.configs import SegmentNiftiStepConfig
from backend.workers.worker_pool import WorkerPool
from backend.workers.ws_broadcaster import WSBroadcaster

if config.SEGMENTATION_MODE == "dummy":
    from backend.workers.subprocesses.segmentation_fn_dummy import (
        _init_segmentation_dummy as _init_segmentation,
    )
else:
    from backend.workers.subprocesses.segmentation_fn import _init_segmentation


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 1. Create data root and tables
    config.DATA_ROOT.mkdir(parents=True, exist_ok=True)
    Base.metadata.create_all(engine)

    # 2. Build storage objects
    storage_engine = LocalStorageEngine(config.DATA_ROOT)
    storage_service = StorageService(storage_engine, SessionLocal)
    broadcaster = WSBroadcaster()

    # 3. Wipe on Startup: abort lingering active UploadSessions
    with SessionLocal() as db:
        hanging = UploadSessionRepo(db).list_by_state("active")

    tmp_upload_svc = UploadService(storage_service, job_pipeline_service=None)
    for session in hanging:
        try:
            tmp_upload_svc.abort_session(session.id)
        except Exception:
            pass

    # 4. CAS OS Sweep Failsafe
    storage_service.sweep_orphans()

    # 5. Worker pools
    dicom_worker_pool = WorkerPool(max_workers=1)
    segmentation_worker_pool = WorkerPool(
        max_workers=1,
        initializer=_init_segmentation,
        initargs=(str(config.MODEL_PATH), config.ONNX_EXECUTION_PROVIDERS),
    )
    worker_pools = {
        "dicom": dicom_worker_pool,
        "segmentation": segmentation_worker_pool,
    }

    step_registry: dict[str, StepFactory] = {
        "segment_nifti": lambda cfg: SegmentNiftiStep(
            config=SegmentNiftiStepConfig.from_mapping(cfg),
        ),
    }

    # 6. Pipeline service
    job_pipeline_service = JobPipelineService(
        worker_pools,
        SessionLocal,
        storage_service,
        broadcaster,
        step_registry=step_registry,
    )

    # 7. Final service instances with full wiring
    study_service = StudyService(storage_service, job_pipeline_service)
    upload_service = UploadService(storage_service, job_pipeline_service)

    # 8. Expose on app.state
    app.state.upload_service = upload_service
    app.state.study_service = study_service
    app.state.job_pipeline_service = job_pipeline_service
    app.state.storage_service = storage_service
    app.state.broadcaster = broadcaster

    yield

    # Shutdown
    await job_pipeline_service.shutdown()


def create_app() -> FastAPI:
    app = FastAPI(title="CBCT Backend", lifespan=lifespan)

    @app.exception_handler(AppError)
    async def _app_error_handler(request: Request, exc: AppError):
        return JSONResponse(
            status_code=exc.status_code,
            content={"detail": exc.detail},
        )

    app.include_router(studies.router)
    app.include_router(uploads.router)
    app.include_router(files.router)
    app.include_router(ws.router)

    return app


app = create_app()
