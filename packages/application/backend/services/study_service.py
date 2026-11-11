from __future__ import annotations

from datetime import date
from pathlib import Path
from typing import TYPE_CHECKING, Callable

from sqlalchemy.orm import Session

from backend.db.models import FileRecord, Study
from backend.db.repos.file_repo import FileRepo
from backend.db.repos.pipeline_job_repo import PipelineJobRepo
from backend.db.repos.study_repo import (
    DEFAULT_STUDY_SORT,
    StudyRepo,
    StudySort,
    StudySortField,
    StudySortOrder,
)
from backend.exceptions import ConflictError, ValidationError
from backend.services.storage_service import StorageService
from backend.utils.status import study_workflow_display_status

if TYPE_CHECKING:
    from backend.services.job_pipeline_service import JobPipelineService


class StudyService:
    def __init__(
        self,
        storage_service: StorageService,
        session_factory: Callable[[], Session],
        job_pipeline_service: JobPipelineService | None = None,
    ) -> None:
        self._storage = storage_service
        self._session_factory = session_factory
        self._pipeline = job_pipeline_service

    def create(
        self,
        name: str | None = None,
    ) -> Study:
        with self._session_factory() as db:
            repo = StudyRepo(db)
            if name is not None:
                name = self._validated_name(repo, name)
            study = repo.create(name=name)
            PipelineJobRepo(db).create_for_study(study.id)
            return study

    def get_with_pipeline(self, study_id: str) -> Study:
        with self._session_factory() as db:
            return StudyRepo(db).get_with_pipeline_job(study_id)

    def list(
        self,
        name: str | None = None,
        *,
        page: int = 1,
        page_size: int = 10,
        created_from: date | None = None,
        created_to: date | None = None,
        sort: StudySort = DEFAULT_STUDY_SORT,
    ) -> tuple[list[Study], int]:
        if page < 1:
            raise ValidationError("page must be >= 1")
        if page_size < 1:
            raise ValidationError("page_size must be >= 1")
        if page_size > 100:
            raise ValidationError("page_size must be <= 100")
        try:
            field, order = sort
            sort = (StudySortField(field), StudySortOrder(order))
        except (TypeError, ValueError):
            raise ValidationError(
                "sort must be a (field, order) pair with "
                f"field in {[f.value for f in StudySortField]} and "
                f"order in {[o.value for o in StudySortOrder]}"
            ) from None
        if created_from is not None and created_to is not None and created_from > created_to:
            raise ValidationError("created_from must be <= created_to")
        with self._session_factory() as db:
            return StudyRepo(db).list(
                name=name,
                page=page,
                page_size=page_size,
                created_from=created_from,
                created_to=created_to,
                sort=sort,
            )

    def rename(self, study_id: str, name: str) -> Study:
        with self._session_factory() as db:
            repo = StudyRepo(db)
            repo.get(study_id)
            name = self._validated_name(repo, name, exclude_id=study_id)
            return repo.rename(study_id, name)

    def list_files(
        self,
        study_id: str,
        viewer_purpose_filter: list[str] | None = None,
    ) -> tuple[list[FileRecord], str]:
        """Return file records and the study workflow display status."""
        with self._session_factory() as db:
            StudyRepo(db).get(study_id)
            records = FileRepo(db).list_by_study(
                study_id, viewer_purpose_filter=viewer_purpose_filter,
            )
            job = PipelineJobRepo(db).get_by_study_id(study_id)
            status = study_workflow_display_status(job.status)
            return records, status

    def resolve_file_content(
        self, study_id: str, file_id: str,
    ) -> tuple[Path, str | None]:
        """Resolve the on-disk path and display name for a study file."""
        with self._session_factory() as db:
            StudyRepo(db).get(study_id)
            record = FileRepo(db).get(file_id)
            path = self._storage.engine.get_study_file_path(
                study_id,
                record.id,
                record.display_name or "file",
            )
            return path, record.display_name

    def retry_pipeline(self, study_id: str) -> Study:
        if self._pipeline is None:
            raise ValidationError("pipeline service is not configured")
        with self._session_factory() as db:
            self._pipeline.retry(study_id, db)
            return StudyRepo(db).get_with_pipeline_job(study_id)

    def cancel_pipeline(self, study_id: str) -> Study:
        if self._pipeline is None:
            raise ValidationError("pipeline service is not configured")
        with self._session_factory() as db:
            self._pipeline.cancel_for_study(study_id, db)
            return StudyRepo(db).get_with_pipeline_job(study_id)

    @staticmethod
    def _validated_name(
        repo: StudyRepo, name: str, exclude_id: str | None = None,
    ) -> str:
        name = name.strip()
        if not name:
            raise ValidationError("scan name must not be empty")
        existing = repo.find_name_conflict(name, exclude_id=exclude_id)
        if existing is not None:
            if existing == name:
                raise ConflictError(f'A scan named "{existing}" already exists.')
            raise ConflictError(
                f'A scan named "{existing}" already exists. Names are not case-sensitive.'
            )
        return name

    def delete(self, study_id: str) -> None:
        with self._session_factory() as db:
            job_repo = PipelineJobRepo(db)
            job = job_repo.get_by_study_id(study_id)
            if self._pipeline is not None and job.status in ("queued", "running"):
                self._pipeline.cancel_for_study(study_id, db)

            file_repo = FileRepo(db)
            blob_hashes = file_repo.delete_by_study(study_id)

            self._storage.engine.remove_study_data(study_id)

            for bh in blob_hashes:
                if file_repo.count_references(bh) == 0:
                    self._storage.engine.delete_blob(bh)

            StudyRepo(db).delete(study_id)
