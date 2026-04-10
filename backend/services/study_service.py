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
        external_id: str | None = None,
        name: str | None = None,
        meta: dict | None = None,
    ) -> Study:
        with self._storage.session_factory() as db:
            study = StudyRepo(db).create(
                name=name, external_id=external_id, meta=meta,
            )
            study_dir = self._storage.engine.root / "studies" / study.id
            (study_dir / "raw").mkdir(parents=True, exist_ok=True)
            (study_dir / "derived").mkdir(parents=True, exist_ok=True)
            return study

    def list(self, external_id: str | None = None) -> list[Study]:
        with self._storage.session_factory() as db:
            return StudyRepo(db).list(external_id=external_id)

    def rename(self, study_id: str, name: str) -> Study:
        with self._storage.session_factory() as db:
            return StudyRepo(db).rename(study_id, name)

    def delete(self, study_id: str) -> None:
        with self._storage.session_factory() as db:
            if self._pipeline is not None:
                job = PipelineJobRepo(db).get_active_for_study(study_id)
                if job:
                    self._pipeline.cancel(job.id)

            file_repo = FileRepo(db)
            blob_hashes = file_repo.delete_by_study(study_id)

            self._storage.engine.remove_study_data(study_id)

            for bh in blob_hashes:
                if file_repo.count_references(bh) == 0:
                    self._storage.engine.delete_blob(bh)

            StudyRepo(db).delete(study_id)
