from __future__ import annotations

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter(tags=["websocket"])


@router.websocket("/ws/pipeline/{job_id}")
async def pipeline_ws(websocket: WebSocket, job_id: str):
    broadcaster = websocket.app.state.broadcaster
    await websocket.accept()
    await broadcaster.register(job_id, websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        await broadcaster.unregister(job_id, websocket)
