from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


def study_workflow_display_status(job_status: str) -> str:
    """Map pipeline job status to values the frontend treats as processing/ready."""
    if job_status in ("queued", "running"):
        return "processing"
    if job_status in ("completed", "ready"):
        return "ready"
    if job_status == "created":
        return "created"
    return job_status


# ---------------------------------------------------------------------------
# Upload
# ---------------------------------------------------------------------------

class BeginUploadRequest(BaseModel):
    kind: Literal["dicom_zip", "nifti_raw", "nifti_mask"]
    filename: str


class BeginUploadResponse(BaseModel):
    upload_id: str
    chunk_size: int


class ChunkUploadResponse(BaseModel):
    index: int
    received: int


class UploadStatusResponse(BaseModel):
    upload_id: str
    state: str
    uploaded_chunks: list[int]


class PipelineRequestItem(BaseModel):
    name: Literal["segment_nifti"]
    config: dict[str, Any] = Field(default_factory=dict)


class FinalizeRequest(BaseModel):
    expected_size: int | None = None
    pipelines: list[PipelineRequestItem] = Field(default_factory=list)


class FinalizeResponse(BaseModel):
    file_id: str
    job_id: str | None = None


# ---------------------------------------------------------------------------
# Study
# ---------------------------------------------------------------------------

class CreateStudyRequest(BaseModel):
    name: str | None = None


class RenameStudyRequest(BaseModel):
    name: str


class StudyResponse(BaseModel):
    id: str
    name: str | None
    created_at: datetime
    status: str

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# File
# ---------------------------------------------------------------------------

class FileRecordResponse(BaseModel):
    id: str
    study_id: str
    kind: str | None
    viewer_purpose: str | None
    display_name: str | None
    blob_hash: str
    size: int
    created_at: datetime
    status: str

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Pipeline Job
# ---------------------------------------------------------------------------

class PipelineJobResponse(BaseModel):
    id: str
    study_id: str
    source_file_id: str | None
    steps: list[str]
    status: str
    created_at: datetime
    error: str | None

    model_config = {"from_attributes": True}
