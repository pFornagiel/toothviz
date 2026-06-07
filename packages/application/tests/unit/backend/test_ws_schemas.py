"""Pipeline WebSocket message schemas stay aligned with the runner payloads."""

from backend.schemas import PipelineWsCompletedMessage


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
