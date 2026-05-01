from __future__ import annotations

from sqlalchemy import func
from sqlalchemy.orm import Session

from backend.db.models import FileRecord
from backend.exceptions import NotFoundError


class FileRepo:
    def __init__(self, db: Session) -> None:
        self._db = db

    def create_file_record(
        self,
        file_id: str,
        study_id: str,
        kind: str | None,
        viewer_purpose: str | None,
        display_name: str | None,
        blob_hash: str,
        size: int,
    ) -> FileRecord:
        record = FileRecord(
            id=file_id,
            study_id=study_id,
            kind=kind,
            viewer_purpose=viewer_purpose,
            display_name=display_name,
            blob_hash=blob_hash,
            size=size,
        )
        self._db.add(record)
        self._db.commit()
        self._db.refresh(record)
        return record

    def get(self, file_id: str) -> FileRecord:
        record = self._db.get(FileRecord, file_id)
        if record is None:
            raise NotFoundError(f"file record not found: {file_id}")
        return record

    def list_by_study(
        self,
        study_id: str,
        viewer_purpose_filter: list[str] | None = None,
    ) -> list[FileRecord]:
        q = self._db.query(FileRecord).filter(FileRecord.study_id == study_id)
        if viewer_purpose_filter:
            q = q.filter(FileRecord.viewer_purpose.in_(viewer_purpose_filter))
        return q.order_by(FileRecord.created_at.asc()).all()

    def count_references(self, blob_hash: str) -> int:
        return (
            self._db.query(func.count(FileRecord.id))
            .filter(FileRecord.blob_hash == blob_hash)
            .scalar()
            or 0
        )

    def clear_viewer_purpose(self, study_id: str, viewer_purpose: str) -> int:
        """Set viewer_purpose=NULL on all records for the given study+purpose.
        Returns the number of rows affected."""
        count = (
            self._db.query(FileRecord)
            .filter(
                FileRecord.study_id == study_id,
                FileRecord.viewer_purpose == viewer_purpose,
            )
            .update({FileRecord.viewer_purpose: None})
        )
        self._db.flush()
        return count

    def delete_by_study(self, study_id: str) -> list[str]:
        """Delete all FileRecords for a study. Returns list of blob_hashes."""
        records = (
            self._db.query(FileRecord)
            .filter(FileRecord.study_id == study_id)
            .all()
        )
        hashes = [r.blob_hash for r in records]
        for r in records:
            self._db.delete(r)
        self._db.commit()
        return hashes
