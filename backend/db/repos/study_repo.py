from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from backend.db.models import Study
from backend.exceptions import NotFoundError


class StudyRepo:
    def __init__(self, db: Session) -> None:
        self._db = db

    def create(
        self,
        name: str | None = None,
        external_id: str | None = None,
        meta: dict | None = None,
    ) -> Study:
        study = Study(
            id=str(uuid.uuid4()),
            name=name,
            external_id=external_id,
            meta=meta or {},
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

    def list(self, external_id: str | None = None) -> list[Study]:
        q = self._db.query(Study)
        if external_id is not None:
            q = q.filter(Study.external_id == external_id)
        return q.order_by(Study.created_at.desc()).all()

    def set_status(self, study_id: str, status: str) -> Study:
        study = self.get(study_id)
        study.status = status
        study.updated_at = datetime.now(timezone.utc)
        self._db.commit()
        self._db.refresh(study)
        return study

    def rename(self, study_id: str, name: str) -> Study:
        study = self.get(study_id)
        study.name = name
        study.updated_at = datetime.now(timezone.utc)
        self._db.commit()
        self._db.refresh(study)
        return study

    def delete(self, study_id: str) -> None:
        study = self.get(study_id)
        self._db.delete(study)
        self._db.commit()
