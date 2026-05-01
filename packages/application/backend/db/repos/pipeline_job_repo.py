from __future__ import annotations

import uuid

from sqlalchemy.orm import Session

from backend.db.models import PipelineJob
from backend.exceptions import NotFoundError


class PipelineJobRepo:
    def __init__(self, db: Session) -> None:
        self._db = db

    def create_for_study(self, study_id: str) -> PipelineJob:
        job = PipelineJob(
            id=str(uuid.uuid4()),
            study_id=study_id,
            steps=[],
            status="created",
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

    def get_by_study_id(self, study_id: str) -> PipelineJob:
        job = (
            self._db.query(PipelineJob)
            .filter(PipelineJob.study_id == study_id)
            .one_or_none()
        )
        if job is None:
            raise NotFoundError(f"pipeline job not found for study: {study_id}")
        return job

    def get_active_for_study(self, study_id: str) -> PipelineJob | None:
        job = (
            self._db.query(PipelineJob)
            .filter(
                PipelineJob.study_id == study_id,
                PipelineJob.status.in_(["queued", "running"]),
            )
            .first()
        )
        return job

    def delete_by_study(self, study_id: str) -> None:
        """Delete all PipelineJob records for a study."""
        self._db.query(PipelineJob).filter(PipelineJob.study_id == study_id).delete()
        self._db.flush()

    def prepare_dispatch(self, study_id: str, step_names: list[str]) -> PipelineJob:
        job = self.get_by_study_id(study_id)
        job.steps = step_names
        job.status = "queued"
        job.error = None
        self._db.commit()
        self._db.refresh(job)
        return job

    def set_status(
        self,
        job_id: str,
        status: str,
        error: str | None = None,
    ) -> PipelineJob:
        job = self.get(job_id)
        job.status = status
        if error is not None:
            job.error = error
        self._db.commit()
        self._db.refresh(job)
        return job
