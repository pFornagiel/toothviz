from __future__ import annotations

import asyncio
import logging
import shutil
from dataclasses import replace

from backend.db.repos.pipeline_job_repo import PipelineJobRepo
from backend.services.storage_service import StorageService
from backend.workers.steps.base import OutputArtifact, PipelineStep, StepContext

logger = logging.getLogger(__name__)


async def run_pipeline(
    job_id: str,
    steps: list[PipelineStep],
    ctx: StepContext,
    storage_service: StorageService,
) -> None:
    """Async orchestrator — runs steps sequentially, commits artifacts at the end.

    Derived files are stored only after every step succeeds.
    If any step fails, no artifacts from this run are persisted (the job is
    marked ``failed`` and the workspace is removed in ``finally``).
    """

    ctx.work_dir.mkdir(parents=True, exist_ok=True)

    with storage_service.session_factory() as db:
        PipelineJobRepo(db).set_status(job_id, "running")

    try:
        collected: dict[str, OutputArtifact] = {}

        for step in steps:
            try:
                result = await step.run(ctx)
            except Exception as exc:
                raise RuntimeError(
                    f"Pipeline step {step.name!r} failed"
                ) from exc

            ctx = replace(ctx, current_input_path=result.next_input_path)
            for artifact in result.artifacts:
                if artifact.purpose in collected:
                    raise _duplicate_purpose_error(
                        step.name, artifact.purpose, collected
                    )
                collected[artifact.purpose] = artifact

        for artifact in collected.values():
            storage_service.store_derived(
                src_path=artifact.path,
                study_id=ctx.study_id,
                filename=artifact.path.name,
                kind=artifact.kind,
                viewer_purpose=artifact.purpose,
            )

        with storage_service.session_factory() as db:
            PipelineJobRepo(db).set_status(job_id, "completed")

        await ctx.broadcaster.broadcast(
            job_id,
            {
                "event": "pipeline_completed",
                "job_id": job_id,
                "status": "completed",
            },
        )

    except asyncio.CancelledError:
        with storage_service.session_factory() as db:
            PipelineJobRepo(db).set_status(job_id, "cancelled")
        await ctx.broadcaster.broadcast(
            job_id,
            {
                "event": "pipeline_cancelled",
                "job_id": job_id,
                "status": "cancelled",
            },
        )
        raise

    except Exception as exc:
        logger.exception("Pipeline %s failed", job_id)
        with storage_service.session_factory() as db:
            PipelineJobRepo(db).set_status(job_id, "failed", error=str(exc))
        await ctx.broadcaster.broadcast(
            job_id,
            {
                "event": "pipeline_failed",
                "job_id": job_id,
                "status": "failed",
                "error": str(exc),
            },
        )

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
