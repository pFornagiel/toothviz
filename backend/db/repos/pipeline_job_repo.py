from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from backend.db.models import PipelineJob
from backend.exceptions import NotFoundError


class PipelineJobRepo:
    def __init__(self, db: Session) -> None:
        self._db = db

    def create(
        self,
        study_id: str,
        source_file_id: str,
        steps: list[str],
    ) -> PipelineJob:
        job = PipelineJob(
            id=str(uuid.uuid4()),
            study_id=study_id,
            source_file_id=source_file_id,
            steps=steps,
        )
        self._db.add(job)
        self._db.commit()
        self._db.refresh(job)
        return job

    def get(self, job_id: str) -> PipelineJob:
        job = self._db.get(PipelineJob, job_id)
        if job is None:
            raise NotFoundError(f"pipeline job not found: {job_id}")
        return job

    def get_active_for_study(self, study_id: str) -> PipelineJob | None:
        return (
            self._db.query(PipelineJob)
            .filter(
                PipelineJob.study_id == study_id,
                PipelineJob.status.in_(["queued", "running"]),
            )
            .first()
        )

    def set_status(
        self,
        job_id: str,
        status: str,
        error: str | None = None,
    ) -> PipelineJob:
        job = self.get(job_id)
        job.status = status
        now = datetime.now(timezone.utc)
        if status == "running":
            job.started_at = now
        if status in ("completed", "failed", "cancelled"):
            job.finished_at = now
        if error is not None:
            job.error = error
        self._db.commit()
        self._db.refresh(job)
        return job
