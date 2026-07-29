from __future__ import annotations

from typing import Any, Callable

from sqlalchemy.orm import Session

from backend.db.repos.file_repo import FileRepo
from backend.db.repos.pipeline_job_repo import PipelineJobRepo
from backend.exceptions import NotFoundError
from backend.schemas import (
    PipelineWsCancelledMessage,
    PipelineWsCompletedMessage,
    PipelineWsFailedMessage,
    PipelineWsStepStartedMessage,
)


def build_pipeline_ws_hydrate(
    session_factory: Callable[[], Session],
) -> Callable[[str], dict[str, Any] | None]:
    """Return a sync hydrate callback for WS reconnect when no in-memory snapshot exists."""

    def hydrate(job_id: str) -> dict[str, Any] | None:
        with session_factory() as db:
            try:
                job = PipelineJobRepo(db).get(job_id)
            except NotFoundError:
                return None

            if job.status == "completed":
                return PipelineWsCompletedMessage(job_id=job.id).model_dump(mode="json")

            if job.status == "failed":
                return PipelineWsFailedMessage(
                    job_id=job.id,
                    error=job.error or "The pipeline reported a failure.",
                    failed_step=None,
                ).model_dump(mode="json")

            if job.status == "cancelled":
                return PipelineWsCancelledMessage(job_id=job.id).model_dump(mode="json")

            if job.status in ("queued", "running"):
                steps = list(job.steps or [])
                total = max(len(steps), 1)
                step = steps[0] if steps else "pipeline"
                artifacts: dict[str, str] = {}
                for f in FileRepo(db).list_by_study(
                    job.study_id,
                    viewer_purpose_filter=["viewer_volume", "viewer_overlay"],
                ):
                    if f.viewer_purpose and f.viewer_purpose not in artifacts:
                        artifacts[f.viewer_purpose] = f.id
                return PipelineWsStepStartedMessage(
                    job_id=job.id,
                    status="running",
                    step=step,
                    step_index=0,
                    total_steps=total,
                    progress=0.0,
                    artifacts=artifacts,
                ).model_dump(mode="json")

            return None

    return hydrate
