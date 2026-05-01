from __future__ import annotations

import uuid

from sqlalchemy.orm import Session, selectinload

from backend.db.models import Study
from backend.exceptions import NotFoundError


class StudyRepo:
    def __init__(self, db: Session) -> None:
        self._db = db

    def create(self, name: str | None = None) -> Study:
        study = Study(
            id=str(uuid.uuid4()),
            name=name,
        )
        self._db.add(study)
        self._db.commit()
        self._db.refresh(study)
        return study

    def get(self, study_id: str) -> Study:
        study = self._db.get(Study, study_id)
        if study is None:
            raise NotFoundError(f"study not found: {study_id}")
        return study

    def get_with_pipeline_job(self, study_id: str) -> Study:
        study_with_job = (
            self._db.query(Study)
            .options(selectinload(Study.pipeline_job))
            .filter(Study.id == study_id)
            .one_or_none()
        )
        if study_with_job is None:
            raise NotFoundError(f"study not found: {study_id}")
        return study_with_job

    def list(self, name: str | None = None) -> list[Study]:
        q = self._db.query(Study).options(selectinload(Study.pipeline_job))
        if name is not None:
            q = q.filter(Study.name == name)
        return q.order_by(Study.created_at.desc()).all()

    def rename(self, study_id: str, name: str) -> Study:
        study = self.get(study_id)
        study.name = name
        self._db.commit()
        self._db.refresh(study)
        return study

    def delete(self, study_id: str) -> None:
        study = self.get(study_id)
        self._db.delete(study)
        self._db.commit()
