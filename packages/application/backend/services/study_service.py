from __future__ import annotations

from typing import TYPE_CHECKING

from backend.db.models import Study
from backend.db.repos.file_repo import FileRepo
from backend.db.repos.pipeline_job_repo import PipelineJobRepo
from backend.db.repos.study_repo import StudyRepo
from backend.services.storage_service import StorageService

if TYPE_CHECKING:
    from backend.services.job_pipeline_service import JobPipelineService


class StudyService:
    def __init__(
        self,
        storage_service: StorageService,
        job_pipeline_service: JobPipelineService | None = None,
    ) -> None:
        self._storage = storage_service
        self._pipeline = job_pipeline_service

    def create(
        self,
        name: str | None = None,
    ) -> Study:
        with self._storage.session_factory() as db:
            study = StudyRepo(db).create(name=name)
            PipelineJobRepo(db).create_for_study(study.id)
            return study

    def list(self, name: str | None = None) -> list[Study]:
        with self._storage.session_factory() as db:
            return StudyRepo(db).list(name=name)

    def rename(self, study_id: str, name: str) -> Study:
        with self._storage.session_factory() as db:
            return StudyRepo(db).rename(study_id, name)

    def delete(self, study_id: str) -> None:
        with self._storage.session_factory() as db:
            job_repo = PipelineJobRepo(db)
            job = job_repo.get_by_study_id(study_id)
            if self._pipeline is not None and job.status in ("queued", "running"):
                self._pipeline.cancel(job.id)

            file_repo = FileRepo(db)
            blob_hashes = file_repo.delete_by_study(study_id)

            self._storage.engine.remove_study_data(study_id)

            for bh in blob_hashes:
                if file_repo.count_references(bh) == 0:
                    self._storage.engine.delete_blob(bh)

            StudyRepo(db).delete(study_id)
