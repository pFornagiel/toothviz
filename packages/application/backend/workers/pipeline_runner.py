from __future__ import annotations

import asyncio
import logging
import re
import shutil
from dataclasses import replace

from backend.db.repos.pipeline_job_repo import PipelineJobRepo
from backend.schemas import (
    PipelineWsCancelledMessage,
    PipelineWsCompletedMessage,
    PipelineWsFailedMessage,
    PipelineWsStepCompletedMessage,
    PipelineWsStepStartedMessage,
)
from backend.services.storage_service import StorageService
from backend.workers.steps.base import OutputArtifact, PipelineStep, StepContext
from backend.workers.ws_broadcaster import WSBroadcaster

logger = logging.getLogger(__name__)


def _extract_failed_step(exc: BaseException) -> str | None:
    m = re.search(r"Pipeline step '([^']+)' failed", str(exc))
    if m:
        return m.group(1)
    return None


def _format_error(exc: BaseException) -> str:
    error_text = str(exc)
    if exc.__cause__ is not None:
        error_text = f"{error_text}. Cause: {exc.__cause__}"
    return error_text


async def _broadcast_cancelled(job_id: str, broadcaster: WSBroadcaster) -> None:
    await broadcaster.broadcast(
        job_id,
        PipelineWsCancelledMessage(job_id=job_id).model_dump(mode="json"),
    )


async def _commit_terminal(
    job_id: str,
    storage_service: StorageService,
    broadcaster: WSBroadcaster,
    *,
    new_status: str,
    from_statuses: tuple[str, ...],
    error: str | None = None,
    failed_step: str | None = None,
) -> str:
    """Atomically write a terminal status and broadcast the matching WS event.

    If another writer already set ``cancelled``, broadcasts cancelled and returns
    that status without applying ``new_status``. If the row is already in some
    other unexpected terminal state, skips the success/failure broadcast.
    """
    with storage_service.session_factory() as db:
        status = PipelineJobRepo(db).update_status_if(
            job_id,
            new_status,
            from_statuses=from_statuses,
            error=error,
        )

    if status == "cancelled":
        await _broadcast_cancelled(job_id, broadcaster)
        return status

    if status != new_status:
        logger.info(
            "Pipeline %s intended %s but status is %s; skipping broadcast",
            job_id,
            new_status,
            status,
        )
        return status

    if new_status == "completed":
        await broadcaster.broadcast(
            job_id,
            PipelineWsCompletedMessage(job_id=job_id).model_dump(mode="json"),
        )
    elif new_status == "failed":
        await broadcaster.broadcast(
            job_id,
            PipelineWsFailedMessage(
                job_id=job_id,
                error=error or "",
                failed_step=failed_step,
            ).model_dump(mode="json"),
        )
    return status


async def run_pipeline(
    job_id: str,
    steps: list[PipelineStep],
    ctx: StepContext,
    storage_service: StorageService,
) -> None:
    """Async orchestrator - runs steps sequentially and stores artifacts as each step finishes.

    Derived files are committed after the producing step succeeds so clients can
    open a volume preview while later steps (e.g. segmentation) still run.
    If a later step fails, earlier artifacts may already be persisted; the job is
    marked ``failed`` and the workspace is removed in ``finally``. The study row
    is kept so the client can surface the failed job status and retry.
    """

    ctx.work_dir.mkdir(parents=True, exist_ok=True)

    with storage_service.session_factory() as db:
        # Policy: only enter running from an active job. Atomic so cancel that
        # already wrote ``cancelled`` is not overwritten by a plain set_status.
        status = PipelineJobRepo(db).update_status_if(
            job_id,
            "running",
            from_statuses=("queued", "running"),
        )

    if status == "cancelled":
        await _broadcast_cancelled(job_id, ctx.broadcaster)
        return

    if status != "running":
        logger.info(
            "Pipeline %s not starting (status=%s after begin-run transition)",
            job_id,
            status,
        )
        return

    total = len(steps)

    try:
        collected: dict[str, OutputArtifact] = {}

        for i, step in enumerate(steps):
            step_ctx = replace(ctx, step_index=i, total_steps=total)
            if total:
                await step_ctx.broadcaster.broadcast(
                    job_id,
                    PipelineWsStepStartedMessage(
                        job_id=job_id,
                        status="running",
                        step=step.name,
                        step_index=i,
                        total_steps=total,
                        progress=i / total,
                    ).model_dump(mode="json"),
                )
            try:
                result = await step.run(step_ctx)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                raise RuntimeError(
                    f"Pipeline step {step.name!r} failed"
                ) from exc

            ctx = replace(ctx, current_input_path=result.next_input_path)
            step_purposes: set[str] = set()
            for artifact in result.artifacts:
                if artifact.purpose in collected:
                    raise _duplicate_purpose_error(
                        step.name, artifact.purpose, collected
                    )
                if artifact.purpose in step_purposes:
                    raise ValueError(
                        f"Duplicate viewer purpose {artifact.purpose!r} "
                        f"emitted by step {step.name!r}"
                    )
                step_purposes.add(artifact.purpose)

            step_committed: dict[str, str] = {}
            for artifact in result.artifacts:
                collected[artifact.purpose] = artifact
                record = storage_service.store_derived(
                    src_path=artifact.path,
                    study_id=ctx.study_id,
                    filename=artifact.path.name,
                    kind=artifact.kind,
                    viewer_purpose=artifact.purpose,
                )
                step_committed[artifact.purpose] = record.id

            if total:
                await step_ctx.broadcaster.broadcast(
                    job_id,
                    PipelineWsStepCompletedMessage(
                        job_id=job_id,
                        step=step.name,
                        step_index=i,
                        total_steps=total,
                        progress=(i + 1) / total if total else 1.0,
                        step_progress=1.0,
                        artifacts=dict(step_committed),
                    ).model_dump(mode="json"),
                )

        await _commit_terminal(
            job_id,
            storage_service,
            ctx.broadcaster,
            new_status="completed",
            from_statuses=("running",),
        )

    except asyncio.CancelledError:
        # Do not overwrite completed/failed if cancel lost the race.
        await _commit_terminal(
            job_id,
            storage_service,
            ctx.broadcaster,
            new_status="cancelled",
            from_statuses=("queued", "running", "created"),
        )
        raise

    except Exception as exc:
        # force_stop can surface as a normal Exception if CancelledError lost a
        # race; never overwrite an intentional cancel with failed.
        error_text = _format_error(exc)
        status = await _commit_terminal(
            job_id,
            storage_service,
            ctx.broadcaster,
            new_status="failed",
            from_statuses=("queued", "running"),
            error=error_text,
            failed_step=_extract_failed_step(exc),
        )
        if status == "failed":
            logger.exception("Pipeline %s failed", job_id)

    finally:
        shutil.rmtree(ctx.work_dir, ignore_errors=True)


def _duplicate_purpose_error(
    step_name: str,
    purpose: str,
    collected: dict[str, OutputArtifact],
) -> ValueError:
    prev = collected[purpose]
    return ValueError(
        f"Duplicate viewer purpose {purpose!r} emitted by step {step_name!r}; "
        f"purpose was already produced as {prev.kind!r}"
    )
