"""WebSocket pipeline progress endpoint."""

import json

import pytest


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
