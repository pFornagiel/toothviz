from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


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

class PipelineWsStepStartedMessage(BaseModel):
    """Pipeline still running; a step has begun."""

    model_config = ConfigDict(extra="forbid")

    event: Literal["step_started"] = "step_started"
    job_id: str
    status: Literal["running"]
    step: str
    step_index: int
    total_steps: int
    progress: float
    # Optional on catch-up frames (committed purposes so far).
    artifacts: dict[str, str] = Field(default_factory=dict)


class PipelineWsStepProgressMessage(BaseModel):
    """Pipeline still running; intra-step progress update."""

    model_config = ConfigDict(extra="forbid")

    event: Literal["step_progress"] = "step_progress"
    job_id: str
    status: Literal["running"]
    step: str
    step_index: int
    total_steps: int
    progress: float
    step_progress: float | None = None
    chunk_index: int | None = None
    total_chunks: int | None = None
    # Optional on catch-up frames (committed purposes so far).
    artifacts: dict[str, str] = Field(default_factory=dict)


class PipelineWsStepCompletedMessage(BaseModel):
    """One step finished; the pipeline may still have more steps.

    ``artifacts`` maps FileRecord viewer purposes (e.g. viewer_volume) to the
    file ids committed by this step. Open-ended so new steps/purposes need no
    schema change.
    """

    model_config = ConfigDict(extra="forbid")

    event: Literal["step_completed"] = "step_completed"
    job_id: str
    step: str
    step_index: int
    total_steps: int
    progress: float
    step_progress: float = 1.0
    artifacts: dict[str, str] = Field(default_factory=dict)


PipelineWsStepMessage = (
    PipelineWsStepStartedMessage
    | PipelineWsStepProgressMessage
    | PipelineWsStepCompletedMessage
)


class PipelineWsCompletedMessage(BaseModel):
    """Pipeline finished successfully.

    File ids are not included — the client loads viewer files via REST using
    FileRecord.viewer_purpose (same contract as a Browse → Open study).
    """

    model_config = ConfigDict(extra="forbid")

    event: Literal["pipeline_completed"] = "pipeline_completed"
    job_id: str
    status: Literal["completed"] = "completed"
    progress: float = 1.0


class PipelineWsFailedMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event: Literal["pipeline_failed"] = "pipeline_failed"
    job_id: str
    status: Literal["failed"] = "failed"
    error: str
    failed_step: str | None = None


class PipelineWsCancelledMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event: Literal["pipeline_cancelled"] = "pipeline_cancelled"
    job_id: str
    status: Literal["cancelled"] = "cancelled"


_WS_STEP_STARTED = "step_started"
_WS_STEP_PROGRESS = "step_progress"
_WS_STEP_COMPLETED = "step_completed"


def validate_pipeline_ws_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Validate and normalize a pipeline WebSocket frame before broadcast.

    Known events are normalized via Pydantic. Missing or unknown ``event``
    raises ``ValueError``.
    """
    event = payload.get("event")
    if not event:
        raise ValueError("pipeline WebSocket payload missing event")
    if event == _WS_STEP_STARTED:
        return PipelineWsStepStartedMessage.model_validate(payload).model_dump(mode="json")
    if event == _WS_STEP_PROGRESS:
        return PipelineWsStepProgressMessage.model_validate(payload).model_dump(mode="json")
    if event == _WS_STEP_COMPLETED:
        return PipelineWsStepCompletedMessage.model_validate(payload).model_dump(mode="json")
    if event == "pipeline_completed":
        return PipelineWsCompletedMessage.model_validate(payload).model_dump(mode="json")
    if event == "pipeline_failed":
        return PipelineWsFailedMessage.model_validate(payload).model_dump(mode="json")
    if event == "pipeline_cancelled":
        return PipelineWsCancelledMessage.model_validate(payload).model_dump(mode="json")
    raise ValueError(f"unknown pipeline WebSocket event: {event}")
