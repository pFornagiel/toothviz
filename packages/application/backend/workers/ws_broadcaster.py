from __future__ import annotations

import asyncio
import json
import logging
from collections import defaultdict
from collections.abc import Callable
from typing import Any

from fastapi import WebSocket
from pydantic import ValidationError

from backend.schemas import validate_pipeline_ws_payload

logger = logging.getLogger(__name__)

_TERMINAL_EVENTS = frozenset(
    {"pipeline_completed", "pipeline_failed", "pipeline_cancelled"},
)

HydrateFn = Callable[[str], dict[str, Any] | None]


class WSBroadcaster:
    """Registry of WebSocket connections keyed by job_id.

    Local desktop assumes at most one active pipeline job; a single asyncio lock
    still serializes register/replay vs broadcast so reconnect cannot race a
    newer live frame.

    Mid-run catch-up merges ``_committed_artifacts`` into the last snapshot so
    reconnect can restore volume preview without putting file ids on
    ``pipeline_completed``.
    """

    def __init__(self, hydrate_job: HydrateFn | None = None) -> None:
        self._registry: dict[str, list[WebSocket]] = defaultdict(list)
        self._last_snapshot: dict[str, dict[str, Any]] = {}
        self._committed_artifacts: dict[str, dict[str, str]] = {}
        self._hydrate_job = hydrate_job
        self._lock = asyncio.Lock()

    async def register(self, job_id: str, ws: WebSocket) -> None:
        async with self._lock:
            self._registry[job_id].append(ws)
            await self._send_catchup_unlocked(job_id, ws)

    async def unregister(self, job_id: str, ws: WebSocket) -> None:
        async with self._lock:
            conns = self._registry.get(job_id)
            if conns is None:
                return
            try:
                conns.remove(ws)
            except ValueError:
                pass
            if not conns:
                self._registry.pop(job_id, None)

    async def _send_catchup_unlocked(self, job_id: str, ws: WebSocket) -> None:
        payload = self._last_snapshot.get(job_id)
        if payload is None and self._hydrate_job is not None:
            try:
                payload = self._hydrate_job(job_id)
            except Exception:
                logger.debug("WebSocket hydrate failed for job %s", job_id, exc_info=True)
                payload = None
        if payload is None:
            return

        event = payload.get("event")
        if event not in _TERMINAL_EVENTS:
            committed = self._committed_artifacts.get(job_id)
            if committed:
                payload = {**payload, "artifacts": dict(committed)}

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
        except (ValidationError, ValueError) as exc:
            logger.warning(
                "Invalid WebSocket payload for job %s event %s: %s",
                job_id,
                event,
                exc,
            )
            return

        async with self._lock:
            event = payload.get("event")
            if event in _TERMINAL_EVENTS:
                self._last_snapshot.pop(job_id, None)
                self._committed_artifacts.pop(job_id, None)
            else:
                if event == "step_completed":
                    arts = payload.get("artifacts") or {}
                    if arts:
                        bag = self._committed_artifacts.setdefault(job_id, {})
                        bag.update(arts)
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
            if not conns:
                self._registry.pop(job_id, None)
