from __future__ import annotations

from fastapi import APIRouter, Query, Request
from fastapi.responses import FileResponse

from backend.schemas import FileRecordResponse

router = APIRouter(prefix="/storage/studies", tags=["files"])


def _svc(request: Request):
    return request.app.state.study_service


@router.get("/{study_id}/files", response_model=list[FileRecordResponse])
def list_files(
    request: Request,
    study_id: str,
    viewer_purpose: str | None = Query(None),
):
    purpose_filter = (
        [p.strip() for p in viewer_purpose.split(",")] if viewer_purpose else None
    )

    records, disp = _svc(request).list_files(
        study_id, viewer_purpose_filter=purpose_filter,
    )
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
    file_path, display_name = _svc(request).resolve_file_content(study_id, file_id)
    return FileResponse(
        path=str(file_path),
        media_type="application/octet-stream",
        filename=display_name,
    )
