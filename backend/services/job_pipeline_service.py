from __future__ import annotations

import asyncio
from typing import Callable

from sqlalchemy.orm import Session

from backend.db.models import FileRecord, PipelineJob
from backend.db.repos.pipeline_job_repo import PipelineJobRepo
from backend.services.storage_service import StorageService
from backend.workers.pipeline_runner import run_pipeline
from backend.workers.steps.base import PipelineStep, StepContext, StepFactory
from backend.workers.steps.dicom_to_nifti import DicomToNiftiStep
from backend.workers.worker_pool import WorkerPool
from backend.workers.ws_broadcaster import WSBroadcaster


class JobPipelineService:
    def __init__(
        self,
        worker_pool: WorkerPool,
        session_factory: Callable[[], Session],
        storage_service: StorageService,
        broadcaster: WSBroadcaster,
        step_registry: dict[str, StepFactory],
    ) -> None:
        self._worker_pool = worker_pool
        self._session_factory = session_factory
        self._storage_service = storage_service
        self._broadcaster = broadcaster
        self._step_registry = step_registry
        self._running: dict[str, asyncio.Task] = {}

    def dispatch(
        self,
        file_record: FileRecord,
        pipelines: list[dict],
        db: Session,
    ) -> str | None:
        # Phase 1: auto-steps
        auto_steps: list[PipelineStep] = []
        if file_record.kind == "dicom_zip":
            auto_steps.append(DicomToNiftiStep())

        # Phase 2: user-requested steps
        user_steps: list[PipelineStep] = []
        for item in pipelines:
            factory = self._step_registry[item["name"]]
            user_steps.append(factory(item.get("config", {})))

        steps = auto_steps + user_steps
        if not steps:
            return None

        job = PipelineJobRepo(db).create(
            study_id=file_record.study_id,
            source_file_id=file_record.id,
            steps=[s.name for s in steps],
        )

        ctx = StepContext(
            job_id=job.id,
            study_id=file_record.study_id,
            current_input_path=self._storage_service.engine.get_cas_blob_path(
                file_record.blob_hash,
            ),
            work_dir=self._storage_service.engine.get_job_workspace_dir(job.id),
            broadcaster=self._broadcaster,
            _worker_pool=self._worker_pool,
        )

        handle = asyncio.create_task(
            run_pipeline(job.id, steps, ctx, self._storage_service),
        )
        self._running[job.id] = handle
        handle.add_done_callback(lambda _: self._running.pop(job.id, None))
        return job.id

    def cancel(self, job_id: str) -> bool:
        handle = self._running.get(job_id)
        if handle is None:
            return False
        handle.cancel()
        return True

    def get_status(self, job_id: str, db: Session) -> PipelineJob:
        return PipelineJobRepo(db).get(job_id)

    async def shutdown(self) -> None:
        for handle in list(self._running.values()):
            handle.cancel()
        self._worker_pool.shutdown(wait=False)
