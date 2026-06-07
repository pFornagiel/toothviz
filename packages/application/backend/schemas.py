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
    name: Literal["segment_nifti", "stub", "passthrough"]
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
    name: str


class RenameStudyRequest(BaseModel):
    name: str


class StudyResponse(BaseModel):
    """Study row/detail. ``status`` is display-facing (processing, ready, failed, ...)."""

    id: str
    name: str
    created_at: datetime
    status: str

    job_id: str | None = None
    pipeline_status: str | None = None
    steps: list[str] = Field(default_factory=list)
    error: str | None = None
    source_file_id: str | None = None

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


# ---------------------------------------------------------------------------
# WebSocket pipeline progress (server → client)
# ---------------------------------------------------------------------------

class PipelineWsStepMessage(BaseModel):
    """Non-terminal step update emitted by the pipeline runner or a step."""

    event: Literal[
        "step_started",
        "step_progress",
        "step_completed",
    ]
    job_id: str
    status: Literal["running"]
    step: str
    step_index: int
    total_steps: int
    progress: float
    step_progress: float | None = None


class PipelineWsCompletedMessage(BaseModel):
    event: Literal["pipeline_completed"] = "pipeline_completed"
    job_id: str
    status: Literal["completed"] = "completed"
    progress: float = 1.0
    volume_file_id: str | None = None
    overlay_file_id: str | None = None


class PipelineWsFailedMessage(BaseModel):
    event: Literal["pipeline_failed"] = "pipeline_failed"
    job_id: str
    status: Literal["failed"] = "failed"
    error: str
    failed_step: str | None = None


class PipelineWsCancelledMessage(BaseModel):
    event: Literal["pipeline_cancelled"] = "pipeline_cancelled"
    job_id: str
    status: Literal["cancelled"] = "cancelled"
