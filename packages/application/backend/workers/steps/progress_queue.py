from __future__ import annotations

import asyncio
import logging
import queue
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any, TypeVar

from backend.workers.steps.base import StepContext

logger = logging.getLogger(__name__)

T = TypeVar("T")

# step_progress, chunk_index, total_chunks
ProgressUpdate = tuple[float, int | None, int | None]


@dataclass
class _ProgressQueueResources:
    queue: Any
    manager: Any | None


def _open_progress_queue() -> _ProgressQueueResources:
    try:
        import multiprocessing

        manager = multiprocessing.Manager()
        return _ProgressQueueResources(queue=manager.Queue(), manager=manager)
    except Exception:
        logger.debug("Progress queue unavailable; intra-step progress disabled", exc_info=True)
        return _ProgressQueueResources(queue=None, manager=None)


def _close_progress_queue(resources: _ProgressQueueResources) -> None:
    if resources.manager is not None:
        try:
            resources.manager.shutdown()
        except Exception:
            logger.debug("Progress queue manager shutdown failed", exc_info=True)


def _drain_queue(
    q: Any,
    parse: Callable[[Any], ProgressUpdate | None],
) -> ProgressUpdate | None:
    if q is None:
        return None
    latest: ProgressUpdate | None = None
    while True:
        try:
            item = q.get_nowait()
        except queue.Empty:
            break
        except Exception:
            logger.debug("Unexpected error draining progress queue", exc_info=True)
            break
        try:
            parsed = parse(item)
            if parsed is not None:
                latest = parsed
        except (TypeError, ValueError):
            continue
    return latest


def parse_float_progress(item: Any) -> ProgressUpdate | None:
    return (max(0.0, min(1.0, float(item))), None, None)


def parse_patch_progress(item: Any) -> ProgressUpdate | None:
    done, total = item
    done_i, total_i = int(done), int(total)
    if total_i <= 0:
        return (0.0, None, None)
    sp = max(0.0, min(1.0, done_i / total_i))
    return (sp, done_i - 1, total_i)


async def run_with_progress_pump(
    ctx: StepContext,
    step_name: str,
    work: Callable[[Any], Awaitable[T]],
    *,
    parse_item: Callable[[Any], ProgressUpdate | None],
    throttle_s: float = 0.5,
) -> T:
    """Run worker code while pumping intra-step progress from a multiprocessing queue."""
    resources = _open_progress_queue()
    stop_evt = asyncio.Event()

    async def pump() -> None:
        last_emit = 0.0
        last_marker: float | None = None
        try:
            while not stop_evt.is_set():
                update = _drain_queue(resources.queue, parse_item)
                if update is not None:
                    sp, chunk_index, total_chunks = update
                    now = time.monotonic()
                    marker = sp if chunk_index is None else float(chunk_index)
                    if (
                        last_marker is None
                        or sp >= 1.0
                        or (now - last_emit) >= throttle_s
                    ):
                        last_emit = now
                        last_marker = marker
                        await ctx.broadcast_progress(
                            step_name=step_name,
                            step_progress=sp,
                            chunk_index=chunk_index,
                            total_chunks=total_chunks,
                        )
                await asyncio.sleep(0.1)
        except Exception:
            logger.debug("Progress pump stopped with error", exc_info=True)

    pump_task = asyncio.create_task(pump())
    try:
        return await work(resources.queue)
    finally:
        stop_evt.set()
        try:
            await pump_task
        except Exception:
            pass
        # Emit any progress left in the queue after the worker returns.
        try:
            update = _drain_queue(resources.queue, parse_item)
            if update is not None:
                sp, chunk_index, total_chunks = update
                await ctx.broadcast_progress(
                    step_name=step_name,
                    step_progress=sp,
                    chunk_index=chunk_index,
                    total_chunks=total_chunks,
                )
        except Exception:
            logger.debug("Final progress drain failed", exc_info=True)
        _close_progress_queue(resources)
