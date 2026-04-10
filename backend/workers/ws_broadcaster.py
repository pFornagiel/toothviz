from __future__ import annotations

import json
import logging
from collections import defaultdict
from typing import Any

from fastapi import WebSocket

logger = logging.getLogger(__name__)


class WSBroadcaster:
    """Registry of WebSocket connections keyed by job_id."""

    def __init__(self) -> None:
        self._registry: dict[str, list[WebSocket]] = defaultdict(list)

    async def register(self, job_id: str, ws: WebSocket) -> None:
        self._registry[job_id].append(ws)

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

    async def broadcast(self, job_id: str, payload: dict[str, Any]) -> None:
        conns = self._registry.get(job_id)
        if not conns:
            return
        text = json.dumps(payload)
        dead: list[WebSocket] = []
        for ws in conns:
            try:
                await ws.send_text(text)
            except Exception:
                dead.append(ws)
        for ws in dead:
            try:
                conns.remove(ws)
            except ValueError:
                pass
