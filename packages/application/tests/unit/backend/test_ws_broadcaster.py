import json
import pytest
from unittest.mock import AsyncMock

from backend.workers.ws_broadcaster import WSBroadcaster


def _step_progress(**overrides):
    payload = {
        "event": "step_progress",
        "job_id": "j1",
        "status": "running",
        "step": "segment_nifti",
        "step_index": 0,
        "total_steps": 1,
        "progress": 0.5,
    }
    payload.update(overrides)
    return payload


@pytest.mark.asyncio
async def test_register_and_broadcast():
    bc = WSBroadcaster()
    ws = AsyncMock()

    await bc.register("j1", ws)
    await bc.broadcast(
        "j1",
        {
            "event": "pipeline_completed",
            "job_id": "j1",
            "status": "completed",
        },
    )

    ws.send_text.assert_called_once()
    payload = json.loads(ws.send_text.call_args[0][0])
    assert payload["event"] == "pipeline_completed"


@pytest.mark.asyncio
async def test_unregister():
    bc = WSBroadcaster()
    ws = AsyncMock()

    await bc.register("j1", ws)
    await bc.unregister("j1", ws)
    await bc.broadcast(
        "j1",
        {"event": "pipeline_completed", "job_id": "j1", "status": "completed"},
    )

    ws.send_text.assert_not_called()


@pytest.mark.asyncio
async def test_broadcast_to_multiple():
    bc = WSBroadcaster()
    ws1 = AsyncMock()
    ws2 = AsyncMock()

    await bc.register("j1", ws1)
    await bc.register("j1", ws2)
    await bc.broadcast("j1", _step_progress())

    ws1.send_text.assert_called_once()
    ws2.send_text.assert_called_once()


@pytest.mark.asyncio
async def test_broadcast_unknown_job_id():
    bc = WSBroadcaster()
    await bc.broadcast("unknown", _step_progress())  # should not raise


@pytest.mark.asyncio
async def test_register_replays_last_non_terminal_snapshot():
    bc = WSBroadcaster()
    ws = AsyncMock()

    await bc.broadcast(
        "j1",
        _step_progress(
            step_index=1,
            total_steps=2,
            progress=0.75,
            chunk_index=2,
            total_chunks=8,
        ),
    )
    await bc.register("j1", ws)

    ws.send_text.assert_called_once()
    replayed = json.loads(ws.send_text.call_args[0][0])
    assert replayed["event"] == "step_progress"
    assert replayed["chunk_index"] == 2


@pytest.mark.asyncio
async def test_catchup_merges_committed_artifacts_into_progress_snapshot():
    bc = WSBroadcaster()
    ws = AsyncMock()

    await bc.broadcast(
        "j1",
        {
            "event": "step_completed",
            "job_id": "j1",
            "step": "dicom_to_nifti",
            "step_index": 0,
            "total_steps": 2,
            "progress": 0.5,
            "step_progress": 1.0,
            "artifacts": {"viewer_volume": "vol-1"},
        },
    )
    await bc.broadcast(
        "j1",
        _step_progress(
            step="segment_nifti",
            step_index=1,
            total_steps=2,
            progress=0.75,
        ),
    )
    await bc.register("j1", ws)

    replayed = json.loads(ws.send_text.call_args[0][0])
    assert replayed["event"] == "step_progress"
    assert replayed["artifacts"]["viewer_volume"] == "vol-1"


@pytest.mark.asyncio
async def test_terminal_events_are_not_cached_for_replay():
    bc = WSBroadcaster()
    ws = AsyncMock()

    await bc.broadcast("j1", {"event": "pipeline_completed", "job_id": "j1", "status": "completed"})
    await bc.register("j1", ws)

    ws.send_text.assert_not_called()


@pytest.mark.asyncio
async def test_terminal_broadcast_evicts_cached_snapshot():
    bc = WSBroadcaster()
    ws = AsyncMock()

    await bc.broadcast("j1", _step_progress())
    await bc.broadcast("j1", {"event": "pipeline_completed", "job_id": "j1", "status": "completed"})
    await bc.register("j1", ws)

    ws.send_text.assert_not_called()


@pytest.mark.asyncio
async def test_register_hydrates_terminal_when_no_snapshot():
    def hydrate(job_id: str):
        return {
            "event": "pipeline_completed",
            "job_id": job_id,
            "status": "completed",
            "progress": 1.0,
        }

    bc = WSBroadcaster(hydrate_job=hydrate)
    ws = AsyncMock()
    await bc.register("j1", ws)

    ws.send_text.assert_called_once()
    replayed = json.loads(ws.send_text.call_args[0][0])
    assert replayed["event"] == "pipeline_completed"
    assert "artifacts" not in replayed


@pytest.mark.asyncio
async def test_unknown_event_is_not_broadcast():
    bc = WSBroadcaster()
    ws = AsyncMock()
    await bc.register("j1", ws)
    await bc.broadcast("j1", {"event": "mystery", "job_id": "j1"})
    assert ws.send_text.call_count == 0


@pytest.mark.asyncio
async def test_missing_event_is_not_broadcast():
    bc = WSBroadcaster()
    ws = AsyncMock()
    await bc.register("j1", ws)
    await bc.broadcast("j1", {"status": "completed"})
    assert ws.send_text.call_count == 0


@pytest.mark.asyncio
async def test_invalid_payload_is_not_broadcast():
    bc = WSBroadcaster()
    ws = AsyncMock()
    await bc.register("j1", ws)

    await bc.broadcast(
        "j1",
        {"event": "step_progress", "step": "segment_nifti"},
    )

    assert ws.send_text.call_count == 0
