"""Pipeline WebSocket message schemas stay aligned with the runner payloads."""

import pytest
from pydantic import ValidationError

from backend.schemas import (
    PipelineWsCompletedMessage,
    PipelineWsStepCompletedMessage,
    PipelineWsStepProgressMessage,
    validate_pipeline_ws_payload,
)


def test_pipeline_completed_schema_has_no_artifacts():
    msg = PipelineWsCompletedMessage(job_id="j1")
    dumped = msg.model_dump()
    assert dumped["event"] == "pipeline_completed"
    assert "artifacts" not in dumped


def test_pipeline_completed_rejects_artifacts():
    with pytest.raises(ValidationError):
        PipelineWsCompletedMessage.model_validate(
            {
                "event": "pipeline_completed",
                "job_id": "j1",
                "status": "completed",
                "artifacts": {"viewer_volume": "vol-1"},
            }
        )


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


def test_step_completed_accepts_artifacts():
    raw = {
        "event": "step_completed",
        "job_id": "j1",
        "step": "dicom_to_nifti",
        "step_index": 0,
        "total_steps": 2,
        "progress": 0.5,
        "step_progress": 1.0,
        "artifacts": {"viewer_volume": "vol-1"},
    }
    validated = validate_pipeline_ws_payload(raw)
    assert validated["artifacts"]["viewer_volume"] == "vol-1"
    PipelineWsStepCompletedMessage.model_validate(validated)


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


def test_unknown_event_is_rejected():
    with pytest.raises(ValueError, match="unknown pipeline WebSocket event"):
        validate_pipeline_ws_payload({"event": "mystery", "job_id": "j1"})
