"""Pipeline WebSocket message schemas stay aligned with the runner payloads."""

from backend.schemas import (
    PipelineWsCompletedMessage,
    PipelineWsStepMessage,
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
    PipelineWsStepMessage.model_validate(validated)
    assert validated["job_id"] == "j1"
