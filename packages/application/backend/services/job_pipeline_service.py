from __future__ import annotations

import asyncio
import concurrent.futures
import logging
from typing import Callable

from sqlalchemy.orm import Session

from backend.db.models import FileRecord
from backend.db.repos.pipeline_job_repo import PipelineJobRepo
from backend.services.storage_service import StorageService
from backend.workers.pipeline_runner import run_pipeline
from backend.workers.steps.base import PipelineStep, StepContext, StepFactory
from backend.workers.steps.dicom_to_nifti import DicomToNiftiStep
from backend.workers.worker_pool import WorkerPool
from backend.workers.ws_broadcaster import WSBroadcaster

logger = logging.getLogger(__name__)


class JobPipelineService:
    """Synchronous facade that dispatches async pipeline work onto the FastAPI event loop.

    Threading model
    ---------------
    FastAPI/uvicorn runs a single asyncio event loop on the main thread.  Sync
    route handlers (and services they call) are offloaded to a thread-pool
    executor — meaning ``dispatch`` and ``cancel`` execute on *worker threads*,
    not on the event loop thread.

    ``run_pipeline`` is an async coroutine that must execute on the event loop
    (it awaits I/O, broadcasts over WebSockets, etc.).  We therefore need a
    thread-safe mechanism to schedule it from a non-async context.

    ``asyncio.run_coroutine_threadsafe`` is the standard library's answer: it
    submits a coroutine to a *foreign* event loop from any thread and returns a
    ``concurrent.futures.Future`` — a thread-safe handle that supports
    ``.cancel()``, ``.result()``, and ``.add_done_callback``.  This is
    distinct from ``asyncio.ensure_future`` / ``asyncio.create_task``, which
    are *not* thread-safe and must only be called from the loop thread.

    The captured ``self._loop`` reference is safe to hold because uvicorn keeps
    the same loop alive for the entire application lifespan.
    """

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

        # Captured here (inside the async lifespan context) so that dispatch(),
        # which runs on a worker thread, can hand coroutines back to this loop.
        self._loop: asyncio.AbstractEventLoop = asyncio.get_running_loop()

        # Maps job_id -> concurrent.futures.Future wrapping the pipeline task.
        # concurrent.futures.Future is used (rather than asyncio.Task) because
        # it is thread-safe: cancel() and add_done_callback() can be called
        # from any thread.
        self._running: dict[str, concurrent.futures.Future[None]] = {}

    def dispatch(
        self,
        file_record: FileRecord,
        pipelines: list[dict],
        db: Session,
    ) -> str | None:
        """Build step chain, update the study's singleton PipelineJob, and schedule execution.

        This method is synchronous because it is called from UploadService,
        which is itself invoked via FastAPI's sync-route thread-pool. Async
        work is handed off via ``run_coroutine_threadsafe`` (see class docstring).
        """
        # Phase 1: auto-steps derived from file type.
        auto_steps: list[PipelineStep] = []
        if file_record.kind == "dicom_zip":
            auto_steps.append(DicomToNiftiStep())

        # Phase 2: user-requested steps from the pipelines payload.
        user_steps: list[PipelineStep] = []
        for item in pipelines:
            factory = self._step_registry[item["name"]]
            user_steps.append(factory(item.get("config", {})))

        steps = auto_steps + user_steps
        if not steps:
            return None

        job = PipelineJobRepo(db).prepare_dispatch(
            file_record.study_id,
            [s.name for s in steps],
        )

        display = file_record.display_name or "file"
        current_path = self._storage_service.engine.get_study_file_path(
            file_record.study_id,
            file_record.id,
            display,
        )

        ctx = StepContext(
            job_id=job.id,
            study_id=file_record.study_id,
            current_input_path=current_path,
            work_dir=self._storage_service.engine.get_job_workspace_dir(job.id),
            broadcaster=self._broadcaster,
            _worker_pool=self._worker_pool,
        )

        # run_coroutine_threadsafe is required because:
        # 1) dispatch() runs on a thread-pool worker, outside the event loop.
        # 2) run_pipeline is async; calling it directly from sync code is invalid.
        # 3) asyncio.create_task is not thread-safe from a non-loop thread.
        # 4) this call safely submits to self._loop and returns immediately.
        future: concurrent.futures.Future[None] = asyncio.run_coroutine_threadsafe(
            run_pipeline(job.id, steps, ctx, self._storage_service),
            self._loop,
        )

        self._running[job.id] = future

        # Remove bookkeeping entry once the pipeline ends (success/failure/cancel).
        future.add_done_callback(lambda _f: self._running.pop(job.id, None))

        logger.debug("Dispatched pipeline job %s with %d step(s)", job.id, len(steps))
        return job.id

    def cancel(self, job_id: str) -> bool:
        """Request cancellation of a running pipeline job.

        Cancelling the concurrent.futures.Future propagates an
        asyncio.CancelledError into the coroutine on the event loop, which
        run_pipeline catches to mark the job as cancelled.
        """
        future = self._running.get(job_id)
        if future is None:
            return False
        future.cancel()
        return True

    def get_status(self, job_id: str, db: Session):
        return PipelineJobRepo(db).get(job_id)

    async def shutdown(self) -> None:
        """Cancel all in-flight jobs and tear down the worker pool."""
        for future in list(self._running.values()):
            future.cancel()
        self._worker_pool.shutdown(wait=False)
