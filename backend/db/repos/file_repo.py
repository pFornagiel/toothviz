from __future__ import annotations

import uuid
from sqlalchemy import func
from sqlalchemy.orm import Session

from backend.db.models import Blob, FileRecord
from backend.exceptions import NotFoundError


class FileRepo:
    def __init__(self, db: Session) -> None:
        self._db = db

    def create_blob(self, hash: str, size: int) -> Blob:
        existing = self._db.get(Blob, hash)
        if existing is not None:
            return existing
        blob = Blob(hash=hash, size=size)
        self._db.add(blob)
        self._db.commit()
        self._db.refresh(blob)
        return blob

    def create_file_record(
        self,
        study_id: str,
        role: str,
        kind: str | None,
        purpose: str | None,
        original_filename: str | None,
        rel_path: str,
        blob_hash: str,
        size: int,
        content_type: str | None = None,
        pipeline_job_id: str | None = None,
        meta: dict | None = None,
    ) -> FileRecord:
        record = FileRecord(
            id=str(uuid.uuid4()),
            study_id=study_id,
            pipeline_job_id=pipeline_job_id,
            role=role,
            kind=kind,
            purpose=purpose,
            original_filename=original_filename,
            rel_path=rel_path,
            blob_hash=blob_hash,
            content_type=content_type,
            size=size,
            meta=meta or {},
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
        purpose_filter: list[str] | None = None,
    ) -> list[FileRecord]:
        q = self._db.query(FileRecord).filter(FileRecord.study_id == study_id)
        if purpose_filter:
            q = q.filter(FileRecord.purpose.in_(purpose_filter))
        return q.order_by(FileRecord.created_at.asc()).all()

    def count_references(self, blob_hash: str) -> int:
        return (
            self._db.query(func.count(FileRecord.id))
            .filter(FileRecord.blob_hash == blob_hash)
            .scalar()
            or 0
        )

    def null_purpose(self, study_id: str, purpose: str) -> int:
        """Set purpose=NULL on all records for the given study+purpose.
        Returns the number of rows affected."""
        count = (
            self._db.query(FileRecord)
            .filter(FileRecord.study_id == study_id, FileRecord.purpose == purpose)
            .update({FileRecord.purpose: None})
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
