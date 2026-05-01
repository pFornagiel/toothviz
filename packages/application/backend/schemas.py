from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Upload
# ---------------------------------------------------------------------------

class BeginUploadRequest(BaseModel):
    kind: Literal["dicom_zip", "nifti_raw", "nifti_mask"]
    filename: str
    content_type: str | None = None
    expected_size: int | None = None
    expected_sha256: str | None = None


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
    expected_sha256: str | None = None
    expected_size: int | None = None
    pipelines: list[PipelineRequestItem] = Field(default_factory=list)


class FinalizeResponse(BaseModel):
    file_id: str
    job_id: str | None = None


# ---------------------------------------------------------------------------
# Study
# ---------------------------------------------------------------------------

class CreateStudyRequest(BaseModel):
    external_id: str | None = None
    name: str | None = None
    meta: dict[str, Any] | None = None


class RenameStudyRequest(BaseModel):
    name: str


class StudyResponse(BaseModel):
    id: str
    name: str | None
    external_id: str | None
    status: str
    created_at: datetime
    updated_at: datetime | None
    meta: dict[str, Any]

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# File
# ---------------------------------------------------------------------------

class FileRecordResponse(BaseModel):
    id: str
    study_id: str
    pipeline_job_id: str | None
    kind: str | None
    purpose: str | None
    original_filename: str | None
    rel_path: str
    blob_hash: str
    size: int
    content_type: str | None
    created_at: datetime
    meta: dict[str, Any]

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Pipeline Job
# ---------------------------------------------------------------------------

class PipelineJobResponse(BaseModel):
    id: str
    study_id: str
    source_file_id: str
    steps: list[str]
    status: str
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None
    error: str | None

    model_config = {"from_attributes": True}
