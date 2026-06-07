import json
import pytest
from unittest.mock import AsyncMock, MagicMock

from backend.workers.ws_broadcaster import WSBroadcaster


@pytest.mark.asyncio
async def test_register_and_broadcast():
    bc = WSBroadcaster()
    ws = AsyncMock()

    await bc.register("j1", ws)
    await bc.broadcast("j1", {"status": "completed"})

    ws.send_text.assert_called_once_with(json.dumps({"status": "completed"}))


@pytest.mark.asyncio
async def test_unregister():
    bc = WSBroadcaster()
    ws = AsyncMock()

    await bc.register("j1", ws)
    await bc.unregister("j1", ws)
    await bc.broadcast("j1", {"status": "completed"})

    ws.send_text.assert_not_called()


@pytest.mark.asyncio
async def test_broadcast_to_multiple():
    bc = WSBroadcaster()
    ws1 = AsyncMock()
    ws2 = AsyncMock()

    await bc.register("j1", ws1)
    await bc.register("j1", ws2)
    await bc.broadcast("j1", {"step": "done"})

    ws1.send_text.assert_called_once()
    ws2.send_text.assert_called_once()


@pytest.mark.asyncio
async def test_broadcast_unknown_job_id():
    bc = WSBroadcaster()
    await bc.broadcast("unknown", {"status": "ok"})  # should not raise


@pytest.mark.asyncio
async def test_register_replays_last_non_terminal_snapshot():
    bc = WSBroadcaster()
    ws = AsyncMock()

    await bc.broadcast(
        "j1",
        {
            "event": "step_progress",
            "step": "segment_nifti",
            "chunk_index": 2,
            "total_chunks": 8,
        },
    )
    await bc.register("j1", ws)

    ws.send_text.assert_called_once()
    replayed = json.loads(ws.send_text.call_args[0][0])
    assert replayed["event"] == "step_progress"
    assert replayed["chunk_index"] == 2


@pytest.mark.asyncio
async def test_terminal_events_are_not_cached_for_replay():
    bc = WSBroadcaster()
    ws = AsyncMock()

    await bc.broadcast("j1", {"event": "pipeline_completed", "status": "completed"})
    await bc.register("j1", ws)

    ws.send_text.assert_not_called()
