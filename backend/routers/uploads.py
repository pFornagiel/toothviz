from __future__ import annotations

from fastapi import APIRouter, Query, Request

from backend.schemas import (
    BeginUploadRequest,
    BeginUploadResponse,
    ChunkUploadResponse,
    FinalizeRequest,
    FinalizeResponse,
    UploadStatusResponse,
)

router = APIRouter(tags=["uploads"])


def _svc(request: Request):
    return request.app.state.upload_service


@router.post(
    "/storage/studies/{study_id}/uploads:begin",
    response_model=BeginUploadResponse,
    status_code=201,
)
def begin_upload(request: Request, study_id: str, body: BeginUploadRequest):
    result = _svc(request).begin_session(
        study_id,
        kind=body.kind,
        filename=body.filename,
        content_type=body.content_type,
        expected_size=body.expected_size,
        expected_sha256=body.expected_sha256,
    )
    return result


@router.put(
    "/storage/uploads/{upload_id}/chunk",
    response_model=ChunkUploadResponse,
)
async def upload_chunk(
    request: Request,
    upload_id: str,
    index: int = Query(...),
):
    data = await request.body()
    result = _svc(request).write_chunk(upload_id, index, data)
    return result


@router.get(
    "/storage/uploads/{upload_id}/status",
    response_model=UploadStatusResponse,
)
def get_upload_status(request: Request, upload_id: str):
    return _svc(request).get_status(upload_id)


@router.post(
    "/storage/uploads/{upload_id}:finalize",
    response_model=FinalizeResponse,
)
def finalize_upload(request: Request, upload_id: str, body: FinalizeRequest):
    pipelines = [p.model_dump() for p in body.pipelines]
    result = _svc(request).finalize(
        upload_id,
        pipelines=pipelines,
        expected_sha256=body.expected_sha256,
        expected_size=body.expected_size,
    )
    return result


@router.delete("/storage/uploads/{upload_id}", status_code=204)
def abort_upload(request: Request, upload_id: str):
    _svc(request).abort_session(upload_id)
