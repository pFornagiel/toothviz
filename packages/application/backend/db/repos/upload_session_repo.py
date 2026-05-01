from __future__ import annotations

import uuid

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
        kind: str,
    ) -> UploadSession:
        session = UploadSession(
            id=str(uuid.uuid4()),
            study_id=study_id,
            filename=filename,
            kind=kind,
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
        self._db.commit()
        self._db.refresh(session)
        return session
