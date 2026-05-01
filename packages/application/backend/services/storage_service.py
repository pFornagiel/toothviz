from __future__ import annotations

from pathlib import Path
from typing import Callable

from sqlalchemy.orm import Session

from backend.db.models import FileRecord
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
        purpose: str | None,
        expected_sha256: str | None,
        expected_size: int | None,
    ) -> FileRecord:
        blob_hash, size = self.engine.commit_upload_to_cas(
            upload_id, expected_sha256, expected_size,
        )
        link_path = self.engine.link_original_file_to_study(
            study_id, filename, blob_hash,
        )
        rel_path = str(Path(link_path).relative_to(self.engine.root))

        with self.session_factory() as db:
            repo = FileRepo(db)
            if purpose:
                repo.null_purpose(study_id, purpose)
            repo.create_blob(blob_hash, size)
            record = repo.create_file_record(
                study_id=study_id,
                kind=kind,
                purpose=purpose,
                original_filename=filename,
                rel_path=rel_path,
                blob_hash=blob_hash,
                size=size,
            )
            return record

    def store_derived(
        self,
        src_path: Path,
        study_id: str,
        job_id: str,
        filename: str,
        kind: str,
        purpose: str | None,
    ) -> FileRecord:
        blob_hash, size = self.engine.commit_file_to_cas(src_path)
        link_path = self.engine.link_derived_file_to_study(
            study_id, filename, blob_hash,
        )
        rel_path = str(Path(link_path).relative_to(self.engine.root))

        with self.session_factory() as db:
            repo = FileRepo(db)
            if purpose:
                repo.null_purpose(study_id, purpose)
            repo.create_blob(blob_hash, size)
            record = repo.create_file_record(
                study_id=study_id,
                kind=kind,
                purpose=purpose,
                original_filename=filename,
                rel_path=rel_path,
                blob_hash=blob_hash,
                size=size,
                pipeline_job_id=job_id,
            )
            return record

    def sweep_orphans(self) -> int:
        return self.engine.sweep_orphaned_blobs()
