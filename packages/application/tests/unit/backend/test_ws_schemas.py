"""Pipeline WebSocket message schemas stay aligned with the runner payloads."""

import pytest
from pydantic import ValidationError

from backend.schemas import (
    PipelineWsCompletedMessage,
    PipelineWsStepCompletedMessage,
    PipelineWsStepProgressMessage,
    validate_pipeline_ws_payload,
)


def test_pipeline_completed_schema_accepts_derived_file_ids():
    msg = PipelineWsCompletedMessage(
        job_id="j1",
        volume_file_id="vol-1",
        overlay_file_id="mask-1",
    )
    dumped = msg.model_dump()
    assert dumped["event"] == "pipeline_completed"
    assert dumped["volume_file_id"] == "vol-1"
    assert dumped["overlay_file_id"] == "mask-1"


def test_validate_pipeline_ws_payload_normalizes_step_progress():
    raw = {
        "event": "step_progress",
        "job_id": "j1",
        "status": "running",
        "step": "segment_nifti",
        "step_index": 0,
        "total_steps": 2,
        "progress": 0.25,
        "step_progress": 0.5,
    }
    validated = validate_pipeline_ws_payload(raw)
    PipelineWsStepProgressMessage.model_validate(validated)
    assert validated["job_id"] == "j1"


def test_step_completed_has_no_pipeline_status():
    raw = {
        "event": "step_completed",
        "job_id": "j1",
        "step": "segment_nifti",
        "step_index": 0,
        "total_steps": 2,
        "progress": 0.5,
        "step_progress": 1.0,
    }
    validated = validate_pipeline_ws_payload(raw)
    assert "status" not in validated
    PipelineWsStepCompletedMessage.model_validate(validated)


def test_step_completed_rejects_pipeline_running_status():
    raw = {
        "event": "step_completed",
        "job_id": "j1",
        "status": "running",
        "step": "segment_nifti",
        "step_index": 0,
        "total_steps": 2,
        "progress": 0.5,
    }
    with pytest.raises(ValidationError):
        validate_pipeline_ws_payload(raw)
