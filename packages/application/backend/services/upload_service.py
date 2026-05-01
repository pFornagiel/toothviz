from __future__ import annotations

from typing import TYPE_CHECKING

from backend import config
from backend.db.repos.pipeline_job_repo import PipelineJobRepo
from backend.db.repos.study_repo import StudyRepo
from backend.db.repos.upload_session_repo import UploadSessionRepo
from backend.exceptions import ConflictError
from backend.services.storage_service import StorageService

if TYPE_CHECKING:
    from backend.services.job_pipeline_service import JobPipelineService

_VIEWER_PURPOSE_MAP: dict[str, str | None] = {
    "nifti_raw": "viewer_volume",
    "nifti_mask": "viewer_overlay",
    "dicom_zip": None,
}


class UploadService:
    def __init__(
        self,
        storage_service: StorageService,
        job_pipeline_service: JobPipelineService | None,
    ) -> None:
        self._storage = storage_service
        self._pipeline = job_pipeline_service

    def begin_session(
        self,
        study_id: str,
        *,
        kind: str,
        filename: str,
        db=None,
    ) -> dict:
        if db is None:
            with self._storage.session_factory() as db:
                return self._begin_session_inner(db, study_id, kind, filename)
        return self._begin_session_inner(db, study_id, kind, filename)

    def _begin_session_inner(self, db, study_id, kind, filename):
        StudyRepo(db).get(study_id)
        chunk_size = config.DEFAULT_CHUNK_SIZE
        session = UploadSessionRepo(db).create(
            study_id=study_id,
            filename=filename,
            kind=kind,
        )
        self._storage.engine.initialize_upload(session.id)
        return {"upload_id": session.id, "chunk_size": chunk_size}

    def write_chunk(self, upload_id: str, index: int, data: bytes) -> dict:
        with self._storage.session_factory() as db:
            session = UploadSessionRepo(db).get(upload_id)
            if session.state != "active":
                raise ConflictError(f"upload session is {session.state}")

            existing_size = self._storage.engine.get_chunk_size(upload_id, index)
            if existing_size is not None and existing_size == len(data):
                return {"index": index, "received": existing_size}

            self._storage.engine.write_chunk(upload_id, index, data)
            return {"index": index, "received": len(data)}

    def get_status(self, upload_id: str) -> dict:
        with self._storage.session_factory() as db:
            session = UploadSessionRepo(db).get(upload_id)
            chunks = self._storage.engine.list_uploaded_chunks(upload_id)
            return {
                "upload_id": session.id,
                "state": session.state,
                "uploaded_chunks": chunks,
            }

    def abort_session(self, upload_id: str) -> None:
        with self._storage.session_factory() as db:
            UploadSessionRepo(db).update_state(upload_id, "aborted")
        self._storage.engine.abort_upload(upload_id)

    def finalize(
        self,
        upload_id: str,
        pipelines: list[dict] | None = None,
        expected_size: int | None = None,
    ) -> dict:
        pipelines = pipelines or []

        with self._storage.session_factory() as db:
            session = UploadSessionRepo(db).get(upload_id)
            if session.state != "active":
                raise ConflictError(f"upload session is {session.state}")

            viewer_purpose = _VIEWER_PURPOSE_MAP.get(session.kind)

            file_record = self._storage.store_original(
                upload_id=upload_id,
                study_id=session.study_id,
                filename=session.filename,
                kind=session.kind,
                viewer_purpose=viewer_purpose,
                expected_sha256=None,
                expected_size=expected_size,
            )

            job_repo = PipelineJobRepo(db)
            job = job_repo.get_by_study_id(session.study_id)
            if session.kind in ("nifti_raw", "dicom_zip"):
                job.source_file_id = file_record.id
                db.commit()

            job_id_dispatch: str | None = None
            if self._pipeline is not None:
                with self._storage.session_factory() as db2:
                    job_id_dispatch = self._pipeline.dispatch(
                        file_record, pipelines, db2,
                    )
            if job_id_dispatch is None:
                job_repo.set_status(job.id, "ready")

            UploadSessionRepo(db).update_state(upload_id, "finalized")

        self._storage.engine.abort_upload(upload_id)

        return {"file_id": file_record.id, "job_id": job_id_dispatch}
