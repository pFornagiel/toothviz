from __future__ import annotations
from fastapi import APIRouter, UploadFile, File, HTTPException, Query, Body
from pydantic import BaseModel
from typing import Optional, Literal

from storage.local import LocalPersistentStorage
from storage.abstract import Role

router = APIRouter(prefix="/storage", tags=["storage"])

store = LocalPersistentStorage(root="./data", sqlite_url="sqlite:///storage.sqlite3")


class BeginUploadRequest(BaseModel):
    role: Role
    kind: str
    filename: str
    content_type: Optional[str] = None
    expected_size: Optional[int] = None
    expected_sha256: Optional[str] = None


@router.post("/studies/{study_id}/uploads:begin")
def begin_upload(study_id: str, req: BeginUploadRequest):
    try:
        upload_id = store.begin_upload(
            study_id=study_id,
            role=req.role,
            kind=req.kind,
            filename=req.filename,
            content_type=req.content_type,
            expected_size=req.expected_size,
            expected_sha256=req.expected_sha256,
        )
        return {"upload_id": upload_id}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.put("/uploads/{upload_id}/chunk")
async def put_chunk(upload_id: str, index: int = Query(..., ge=0), chunk: UploadFile = File(...)):
    data = await chunk.read()
    try:
        store.upload_chunk(upload_id, index, data)
        return {"received": len(data), "index": index}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/uploads/{upload_id}:finalize")
def finalize_upload(upload_id: str):
    try:
        rec = store.finalize_upload(upload_id)
        return {"file_id": rec.id, "rel_path": rec.rel_path, "sha256": rec.checksum_sha256, "size": rec.size}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))