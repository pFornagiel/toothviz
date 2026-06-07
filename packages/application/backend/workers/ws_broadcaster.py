from __future__ import annotations

import json
import logging
from collections import defaultdict
from typing import Any

from fastapi import WebSocket
from pydantic import ValidationError

from backend.schemas import validate_pipeline_ws_payload

logger = logging.getLogger(__name__)

_TERMINAL_EVENTS = frozenset(
    {"pipeline_completed", "pipeline_failed", "pipeline_cancelled"},
)


class WSBroadcaster:
    """Registry of WebSocket connections keyed by job_id."""

    def __init__(self) -> None:
        self._registry: dict[str, list[WebSocket]] = defaultdict(list)
        self._last_snapshot: dict[str, dict[str, Any]] = {}

    async def register(self, job_id: str, ws: WebSocket) -> None:
        self._registry[job_id].append(ws)
        await self.replay_snapshot(job_id, ws)

    async def unregister(self, job_id: str, ws: WebSocket) -> None:
        conns = self._registry.get(job_id)
        if conns is None:
            return
        try:
            conns.remove(ws)
        except ValueError:
            pass
        if not conns:
            self._registry.pop(job_id, None)

    async def replay_snapshot(self, job_id: str, ws: WebSocket) -> None:
        """Send the last non-terminal progress frame to a newly connected client."""
        payload = self._last_snapshot.get(job_id)
        if payload is None:
            return
        try:
            await ws.send_text(json.dumps(payload))
        except Exception as exc:
            logger.warning(
                "WebSocket snapshot replay failed for job %s: %s", job_id, exc
            )

    async def broadcast(self, job_id: str, payload: dict[str, Any]) -> None:
        event = payload.get("event")
        try:
            payload = validate_pipeline_ws_payload(payload)
        except ValidationError as exc:
            logger.warning(
                "Invalid WebSocket payload for job %s event %s: %s",
                job_id,
                event,
                exc,
            )
            return

        event = payload.get("event")
        if event in _TERMINAL_EVENTS:
            self._last_snapshot.pop(job_id, None)
        elif event is not None:
            self._last_snapshot[job_id] = payload

        conns = self._registry.get(job_id)
        if not conns:
            return
        text = json.dumps(payload)
        dead: list[WebSocket] = []
        for ws in conns:
            try:
                await ws.send_text(text)
            except Exception as exc:
                logger.warning(
                    "WebSocket send failed for job %s: %s", job_id, exc
                )
                dead.append(ws)
        for ws in dead:
            try:
                conns.remove(ws)
            except ValueError:
                pass
