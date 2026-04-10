from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Query, Request
from fastapi.responses import FileResponse

from backend.db.repos.file_repo import FileRepo
from backend.schemas import FileRecordResponse

router = APIRouter(prefix="/storage/studies", tags=["files"])


@router.get("/{study_id}/files", response_model=list[FileRecordResponse])
def list_files(
    request: Request,
    study_id: str,
    purpose: str | None = Query(None),
):
    if purpose:
        purpose_filter = [p.strip() for p in purpose.split(",")]

    storage_svc = request.app.state.storage_service
    with storage_svc.session_factory() as db:
        records = FileRepo(db).list_by_study(study_id, purpose_filter=purpose_filter)
        return records


@router.get("/{study_id}/files/{file_id}/content")
def get_file_content(request: Request, study_id: str, file_id: str):
    storage_svc = request.app.state.storage_service
    with storage_svc.session_factory() as db:
        record = FileRepo(db).get(file_id)
        file_path = Path(storage_svc.engine.root) / record.rel_path
        return FileResponse(
            path=str(file_path),
            media_type=record.content_type or "application/octet-stream",
            filename=record.original_filename,
        )
