from __future__ import annotations

import asyncio
import logging
import shutil
from dataclasses import replace

from backend.db.repos.pipeline_job_repo import PipelineJobRepo
from backend.db.repos.study_repo import StudyRepo
from backend.workers.steps.base import OutputArtifact, PipelineStep, StepContext
from backend.services.storage_service import StorageService

logger = logging.getLogger(__name__)

async def run_pipeline(
    job_id: str,
    steps: list[PipelineStep],
    ctx: StepContext,
    storage_service,
) -> None:
    """Async orchestrator — runs steps sequentially, commits artifacts at the end."""
    storage_service: StorageService = storage_service

    ctx.work_dir.mkdir(parents=True, exist_ok=True)

    with storage_service.session_factory() as db:
        PipelineJobRepo(db).set_status(job_id, "running")

    try:
        collected: dict[str, OutputArtifact] = {}

        for step in steps:
            result = await step.run(ctx)
            ctx = replace(ctx, current_input_path=result.next_input_path)
            for artifact in result.artifacts:
                if artifact.purpose in collected:
                    logger.info("Artifact purpose %r overwritten by step output", artifact.purpose)
                collected[artifact.purpose] = artifact

        for artifact in collected.values():
            storage_service.store_derived(
                src_path=artifact.path,
                study_id=ctx.study_id,
                job_id=job_id,
                filename=artifact.path.name,
                kind=artifact.kind,
                purpose=artifact.purpose,
            )

        with storage_service.session_factory() as db:
            PipelineJobRepo(db).set_status(job_id, "completed")
            StudyRepo(db).set_status(ctx.study_id, "ready")

        await ctx.broadcaster.broadcast(job_id, {"status": "completed"})

    except asyncio.CancelledError:
        with storage_service.session_factory() as db:
            PipelineJobRepo(db).set_status(job_id, "cancelled")
        raise

    except Exception as exc:
        logger.exception("Pipeline %s failed", job_id)
        with storage_service.session_factory() as db:
            PipelineJobRepo(db).set_status(job_id, "failed", error=str(exc))
        await ctx.broadcaster.broadcast(job_id, {"status": "failed", "error": str(exc)})

    finally:
        shutil.rmtree(ctx.work_dir, ignore_errors=True)
