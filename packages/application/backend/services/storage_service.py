from __future__ import annotations

import uuid
from pathlib import Path
from typing import Callable

from sqlalchemy.orm import Session

from backend.db.repos.file_repo import FileRepo
from backend.storage.engine import StorageEngine


class StorageService:
    """Combines CAS engine operations with DB FileRecord management."""

    def __init__(
        self,
        engine: StorageEngine,
        session_factory: Callable[[], Session],
    ) -> None:
        self.engine = engine
        self.session_factory = session_factory

    def store_original(
        self,
        upload_id: str,
        study_id: str,
        filename: str,
        kind: str,
        viewer_purpose: str | None,
        expected_sha256: str | None,
        expected_size: int | None,
    ):
        blob_hash, size = self.engine.commit_upload_to_cas(
            upload_id, expected_sha256, expected_size,
        )
        file_id = str(uuid.uuid4())
        self.engine.link_study_file(
            study_id, file_id, filename, blob_hash,
        )

        with self.session_factory() as db:
            repo = FileRepo(db)
            if viewer_purpose:
                repo.clear_viewer_purpose(study_id, viewer_purpose)
            record = repo.create_file_record(
                file_id=file_id,
                study_id=study_id,
                kind=kind,
                viewer_purpose=viewer_purpose,
                display_name=filename,
                blob_hash=blob_hash,
                size=size,
            )
            return record

    def store_derived(
        self,
        src_path: Path,
        study_id: str,
        filename: str,
        kind: str,
        viewer_purpose: str | None,
        file_id: str | None = None,
    ):
        blob_hash, size = self.engine.commit_file_to_cas(src_path)
        fid = file_id or str(uuid.uuid4())
        self.engine.link_study_file(
            study_id, fid, filename, blob_hash,
        )

        with self.session_factory() as db:
            repo = FileRepo(db)
            if viewer_purpose:
                repo.clear_viewer_purpose(study_id, viewer_purpose)
            record = repo.create_file_record(
                file_id=fid,
                study_id=study_id,
                kind=kind,
                viewer_purpose=viewer_purpose,
                display_name=filename,
                blob_hash=blob_hash,
                size=size,
            )
            return record

    def sweep_orphans(self) -> int:
        return self.engine.sweep_orphaned_blobs()
