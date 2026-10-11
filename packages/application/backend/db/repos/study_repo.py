from __future__ import annotations

import uuid

from sqlalchemy import func
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

    @staticmethod
    def _escape_like(value: str) -> str:
        return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")

    def list(
        self,
        name: str | None = None,
        *,
        page: int = 1,
        page_size: int = 10,
    ) -> tuple[list[Study], int]:
        """Return a page of studies and the total matching count.

        ``name`` matches as a case-insensitive substring when provided.
        """
        q = self._db.query(Study)
        if name is not None:
            trimmed = name.strip()
            if trimmed:
                pattern = f"%{self._escape_like(trimmed)}%"
                q = q.filter(Study.name.ilike(pattern, escape="\\"))

        total = q.count()
        items = (
            q.options(selectinload(Study.pipeline_job))
            .order_by(Study.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
            .all()
        )
        return items, total

    def find_name_conflict(self, name: str, exclude_id: str | None = None) -> str | None:
        """Return the stored name of another study matching ``name`` case-insensitively."""
        q = self._db.query(Study.name).filter(func.lower(Study.name) == name.lower())
        if exclude_id is not None:
            q = q.filter(Study.id != exclude_id)
        row = q.first()
        return row.name if row is not None else None

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
