from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from backend.db.models import UploadSession
from backend.exceptions import NotFoundError


class UploadSessionRepo:
    def __init__(self, db: Session) -> None:
        self._db = db

    def create(
        self,
        study_id: str,
        filename: str,
        role: str,
        kind: str,
        chunk_size: int,
        content_type: str | None = None,
        expected_size: int | None = None,
        expected_sha256: str | None = None,
    ) -> UploadSession:
        session = UploadSession(
            id=str(uuid.uuid4()),
            study_id=study_id,
            filename=filename,
            role=role,
            kind=kind,
            chunk_size=chunk_size,
            content_type=content_type,
            expected_size=expected_size,
            expected_sha256=expected_sha256,
        )
        self._db.add(session)
        self._db.commit()
        self._db.refresh(session)
        return session

    def get(self, upload_id: str) -> UploadSession:
        session = self._db.get(UploadSession, upload_id)
        if session is None:
            raise NotFoundError(f"upload session not found: {upload_id}")
        return session

    def list_by_state(self, state: str) -> list[UploadSession]:
        return (
            self._db.query(UploadSession)
            .filter(UploadSession.state == state)
            .all()
        )

    def update_state(self, upload_id: str, state: str) -> UploadSession:
        session = self.get(upload_id)
        session.state = state
        session.updated_at = datetime.now(timezone.utc)
        self._db.commit()
        self._db.refresh(session)
        return session
