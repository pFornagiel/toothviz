"""WebSocket pipeline progress endpoint."""

import json

import pytest


def _step_progress_payload(job_id: str) -> dict:
    return {
        "event": "step_progress",
        "job_id": job_id,
        "status": "running",
        "step": "segment_nifti",
        "step_index": 1,
        "total_steps": 2,
        "progress": 0.75,
        "step_progress": 0.5,
        "chunk_index": 1,
        "total_chunks": 4,
    }


@pytest.mark.asyncio
async def test_ws_pipeline_replays_last_progress_on_connect(integration_app, client):
    job_id = "job-ws-replay"
    broadcaster = integration_app.state.broadcaster
    await broadcaster.broadcast(job_id, _step_progress_payload(job_id))

    with client.websocket_connect(f"/ws/pipeline/{job_id}") as ws:
        payload = json.loads(ws.receive_text())
        assert payload["event"] == "step_progress"
        assert payload["chunk_index"] == 1


@pytest.mark.asyncio
async def test_ws_pipeline_receives_broadcast(integration_app, client):
    """Client subscribed to a job_id receives JSON frames from WSBroadcaster."""
    job_id = "job-ws-test"
    with client.websocket_connect(f"/ws/pipeline/{job_id}") as ws:
        broadcaster = integration_app.state.broadcaster
        await broadcaster.broadcast(
            job_id,
            {
                "event": "pipeline_completed",
                "job_id": job_id,
                "status": "completed",
                "progress": 1.0,
                "overlay_file_id": "mask-abc",
            },
        )
        raw = ws.receive_text()
        payload = json.loads(raw)
        assert payload["event"] == "pipeline_completed"
        assert payload["overlay_file_id"] == "mask-abc"
