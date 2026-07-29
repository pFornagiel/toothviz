from __future__ import annotations

import asyncio
import concurrent.futures
import logging
from typing import Callable

from sqlalchemy.orm import Session

from backend.db.models import FileRecord
from backend.db.repos.file_repo import FileRepo
from backend.db.repos.pipeline_job_repo import PipelineJobRepo
from backend.exceptions import ConflictError, ValidationError
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
    executor - meaning ``dispatch`` and ``cancel`` execute on *worker threads*,
    not on the event loop thread.

    ``run_pipeline`` is an async coroutine that must execute on the event loop
    (it awaits I/O, broadcasts over WebSockets, etc.).  We therefore need a
    thread-safe mechanism to schedule it from a non-async context.

    ``asyncio.run_coroutine_threadsafe`` is the standard library's answer: it
    submits a coroutine to a *foreign* event loop from any thread and returns a
    ``concurrent.futures.Future`` - a thread-safe handle that supports
    ``.cancel()``, ``.result()``, and ``.add_done_callback``.  This is
    distinct from ``asyncio.ensure_future`` / ``asyncio.create_task``, which
    are *not* thread-safe and must only be called from the loop thread.

    The captured ``self._loop`` reference is safe to hold because uvicorn keeps
    the same loop alive for the entire application lifespan.

    Cancellation is **best-effort**: cancelling the concurrent future can stop
    the asyncio side of the pipeline, but work already submitted to
    ``ProcessPoolExecutor`` may still run to completion in child processes.
    """

    def __init__(
        self,
        worker_pools: dict[str, WorkerPool],
        session_factory: Callable[[], Session],
        storage_service: StorageService,
        broadcaster: WSBroadcaster,
        step_registry: dict[str, StepFactory],
    ) -> None:
        self._worker_pools = worker_pools
        self._session_factory = session_factory
        self._storage_service = storage_service
        self._broadcaster = broadcaster
        self._step_registry = step_registry

        # Captured here so that dispatch(), which runs on a worker thread, can
        # hand coroutines back to this loop (see class docstring).
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
        auto_steps: list[PipelineStep] = []
        if file_record.kind == "dicom_zip":
            auto_steps.append(DicomToNiftiStep())

        user_steps: list[PipelineStep] = []
        for item in pipelines:
            factory = self._step_registry[item["name"]]
            user_steps.append(factory(item.get("config", {})))

        steps = auto_steps + user_steps
        if not steps:
            return None

        active = PipelineJobRepo(db).get_active_for_study(file_record.study_id)
        if active is not None:
            raise ConflictError(
                f"pipeline already {active.status} for this study "
                f"(job_id={active.id})"
            )

        job = PipelineJobRepo(db).prepare_dispatch(
            file_record.study_id,
            [s.name for s in steps],
        )
        return self._schedule(job.id, steps, file_record)

    def retry(self, study_id: str, db: Session) -> str:
        """Re-run the pipeline for a failed/cancelled study that still has a source upload."""
        job = PipelineJobRepo(db).get_by_study_id(study_id)
        if job.status in ("queued", "running"):
            raise ConflictError(
                f"pipeline already {job.status} for this study (job_id={job.id})"
            )
        if job.status not in ("failed", "cancelled"):
            raise ValidationError(
                f"pipeline can only be retried when failed or cancelled "
                f"(current status={job.status})"
            )
        if not job.source_file_id:
            raise ValidationError("study has no uploaded source file to retry")

        file_record = FileRepo(db).get(job.source_file_id)
        # Clear prior *derived* viewer bindings so a fresh run can replace them.
        # Never clear the source upload itself — nifti_raw studies use that
        # file as viewer_volume (preview + final volume alongside the mask).
        file_repo = FileRepo(db)
        file_repo.clear_viewer_purpose(
            study_id, "viewer_volume", exclude_file_id=job.source_file_id
        )
        file_repo.clear_viewer_purpose(
            study_id, "viewer_overlay", exclude_file_id=job.source_file_id
        )
        db.commit()

        steps = self._steps_from_names(list(job.steps or []), file_record)
        if not steps:
            raise ValidationError("no pipeline steps available to retry")

        prepared = PipelineJobRepo(db).prepare_dispatch(
            study_id,
            [s.name for s in steps],
        )
        return self._schedule(prepared.id, steps, file_record)

    def _schedule(
        self,
        job_id: str,
        steps: list[PipelineStep],
        file_record: FileRecord,
    ) -> str:
        """Build StepContext and hand ``run_pipeline`` to the event loop."""
        display = file_record.display_name or "file"
        current_path = self._storage_service.engine.get_study_file_path(
            file_record.study_id,
            file_record.id,
            display,
        )

        ctx = StepContext(
            job_id=job_id,
            study_id=file_record.study_id,
            current_input_path=current_path,
            work_dir=self._storage_service.engine.get_job_workspace_dir(job_id),
            broadcaster=self._broadcaster,
            worker_pools=self._worker_pools,
        )

        future: concurrent.futures.Future[None] = asyncio.run_coroutine_threadsafe(
            run_pipeline(
                job_id,
                steps,
                ctx,
                self._storage_service,
            ),
            self._loop,
        )

        self._running[job_id] = future
        future.add_done_callback(lambda _f: self._running.pop(job_id, None))

        logger.debug("Scheduled pipeline job %s with %d step(s)", job_id, len(steps))
        return job_id

    def _steps_from_names(
        self,
        step_names: list[str],
        file_record: FileRecord,
    ) -> list[PipelineStep]:
        """Rebuild a step chain from stored names (and file kind for DICOM)."""
        steps: list[PipelineStep] = []
        seen: set[str] = set()

        if file_record.kind == "dicom_zip" and "dicom_to_nifti" not in step_names:
            steps.append(DicomToNiftiStep())
            seen.add("dicom_to_nifti")

        for name in step_names:
            if name in seen:
                continue
            seen.add(name)
            if name == "dicom_to_nifti":
                steps.append(DicomToNiftiStep())
            elif name in self._step_registry:
                steps.append(self._step_registry[name]({}))
            else:
                raise ValidationError(f"unknown pipeline step: {name}")
        return steps

    def cancel(self, job_id: str) -> bool:
        """Request cancellation of a running pipeline job.

        Cancelling the concurrent.futures.Future propagates an
        asyncio.CancelledError into the coroutine on the event loop, which
        run_pipeline catches to mark the job as cancelled.

        This does not guarantee subprocess work stops immediately; see class docstring.
        """
        future = self._running.get(job_id)
        if future is None:
            return False
        future.cancel()
        return True

    def get_status(self, job_id: str, db: Session):
        return PipelineJobRepo(db).get(job_id)

    async def shutdown(self) -> None:
        """Cancel all in-flight jobs and tear down the worker pools."""
        for future in list(self._running.values()):
            future.cancel()
        for pool in self._worker_pools.values():
            pool.shutdown(wait=True)
