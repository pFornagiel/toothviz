from __future__ import annotations

from fastapi import APIRouter, Query, Request
from fastapi.responses import FileResponse

from backend.db.repos.file_repo import FileRepo
from backend.db.repos.pipeline_job_repo import PipelineJobRepo
from backend.schemas import FileRecordResponse
from backend.utils.status import study_workflow_display_status

router = APIRouter(prefix="/storage/studies", tags=["files"])


@router.get("/{study_id}/files", response_model=list[FileRecordResponse])
def list_files(
    request: Request,
    study_id: str,
    viewer_purpose: str | None = Query(None),
):
    purpose_filter = (
        [p.strip() for p in viewer_purpose.split(",")] if viewer_purpose else None
    )

    storage_svc = request.app.state.storage_service
    with storage_svc.session_factory() as db:
        records = FileRepo(db).list_by_study(
            study_id, viewer_purpose_filter=purpose_filter,
        )
        job = PipelineJobRepo(db).get_by_study_id(study_id)
        disp = study_workflow_display_status(job.status)
        return [
            FileRecordResponse(
                id=r.id,
                study_id=r.study_id,
                kind=r.kind,
                viewer_purpose=r.viewer_purpose,
                display_name=r.display_name,
                blob_hash=r.blob_hash,
                size=r.size,
                created_at=r.created_at,
                status=disp,
            )
            for r in records
        ]


@router.get("/{study_id}/files/{file_id}/content")
def get_file_content(request: Request, study_id: str, file_id: str):
    storage_svc = request.app.state.storage_service
    with storage_svc.session_factory() as db:
        record = FileRepo(db).get(file_id)
        file_path = storage_svc.engine.get_study_file_path(
            study_id,
            record.id,
            record.display_name or "file",
        )
        return FileResponse(
            path=str(file_path),
            media_type="application/octet-stream",
            filename=record.display_name,
        )
