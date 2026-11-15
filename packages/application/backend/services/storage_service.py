from __future__ import annotations

import uuid
from pathlib import Path

from sqlalchemy.orm import Session

from backend.db.repos.file_repo import FileRepo
from backend.storage.engine import StorageEngine


class StorageService:
    """Coordinates CAS / study-file I/O. Does not own the DB session factory.

    Callers inject ``session_factory`` separately and pass an open ``Session`` into
    ``store_original`` / ``store_derived`` so metadata writes stay on the caller's
    unit of work.
    """

    def __init__(self, engine: StorageEngine) -> None:
        self.engine = engine

    def store_original(
        self,
        upload_id: str,
        study_id: str,
        filename: str,
        kind: str,
        viewer_purpose: str | None,
        expected_sha256: str | None,
        expected_size: int | None,
        db: Session,
    ):
        blob_hash, size = self.engine.commit_upload_to_cas(
            upload_id, expected_sha256, expected_size,
        )
        file_id = str(uuid.uuid4())
        self.engine.link_study_file(
            study_id, file_id, filename, blob_hash,
        )

        repo = FileRepo(db)
        if viewer_purpose:
            repo.clear_viewer_purpose(study_id, viewer_purpose)
        return repo.create_file_record(
            file_id=file_id,
            study_id=study_id,
            kind=kind,
            viewer_purpose=viewer_purpose,
            display_name=filename,
            blob_hash=blob_hash,
            size=size,
        )

    def store_derived(
        self,
        src_path: Path,
        study_id: str,
        filename: str,
        kind: str,
        viewer_purpose: str | None,
        db: Session,
        file_id: str | None = None,
    ):
        blob_hash, size = self.engine.commit_file_to_cas(src_path)
        fid = file_id or str(uuid.uuid4())
        self.engine.link_study_file(
            study_id, fid, filename, blob_hash,
        )

        repo = FileRepo(db)
        if viewer_purpose:
            repo.clear_viewer_purpose(study_id, viewer_purpose)
        return repo.create_file_record(
            file_id=fid,
            study_id=study_id,
            kind=kind,
            viewer_purpose=viewer_purpose,
            display_name=filename,
            blob_hash=blob_hash,
            size=size,
        )

    def sweep_orphans(self) -> int:
        return self.engine.sweep_orphaned_blobs()
