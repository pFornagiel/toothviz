from __future__ import annotations

import asyncio
import logging
import threading
from concurrent.futures import CancelledError as FuturesCancelledError
from concurrent.futures import Future, ProcessPoolExecutor
from typing import Any, Callable

logger = logging.getLogger(__name__)


class WorkerPool:
    """Generic wrapper around ProcessPoolExecutor.

    ``force_stop`` terminates worker processes and recreates the executor so
    in-flight CPU work (e.g. segmentation) can be cancelled hard; the next
    ``run`` pays initializer cost again (model reload).
    """

    def __init__(
        self,
        max_workers: int = 1,
        initializer: Callable | None = None,
        initargs: tuple = (),
    ) -> None:
        self._max_workers = max_workers
        self._initializer = initializer
        self._initargs = initargs
        self._lock = threading.Lock()
        self._inflight: set[Future[Any]] = set()
        self._stop_generation = 0
        self._pool = self._new_executor()

    def _new_executor(self) -> ProcessPoolExecutor:
        return ProcessPoolExecutor(
            max_workers=self._max_workers,
            initializer=self._initializer,
            initargs=self._initargs,
        )

    async def run(self, fn: Callable, *args: Any) -> Any:
        with self._lock:
            generation = self._stop_generation
            fut = self._pool.submit(fn, *args)
            self._inflight.add(fut)

        def _discard(_f: Future[Any]) -> None:
            with self._lock:
                self._inflight.discard(_f)

        fut.add_done_callback(_discard)
        try:
            return await asyncio.wrap_future(fut)
        except FuturesCancelledError as exc:
            raise asyncio.CancelledError from exc
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            with self._lock:
                stopped = self._stop_generation != generation
            if stopped:
                # Process was killed by force_stop — surface as cancel, not failure.
                raise asyncio.CancelledError from exc
            raise

    def force_stop(self) -> None:
        """Kill worker processes, cancel in-flight futures, and recreate the pool."""
        with self._lock:
            self._stop_generation += 1
            for fut in list(self._inflight):
                fut.cancel()
            self._inflight.clear()

            processes = getattr(self._pool, "_processes", None) or {}
            for proc in list(processes.values()):
                try:
                    proc.kill()
                except Exception:
                    logger.debug("Failed to kill worker process", exc_info=True)

            try:
                self._pool.shutdown(wait=False, cancel_futures=True)
            except TypeError:
                # Python without cancel_futures
                try:
                    self._pool.shutdown(wait=False)
                except Exception:
                    logger.debug("Worker pool shutdown failed", exc_info=True)
            except Exception:
                logger.debug("Worker pool shutdown failed", exc_info=True)

            self._pool = self._new_executor()

    def shutdown(self, wait: bool = False) -> None:
        with self._lock:
            for fut in list(self._inflight):
                fut.cancel()
            self._inflight.clear()
            try:
                self._pool.shutdown(wait=wait, cancel_futures=True)
            except TypeError:
                self._pool.shutdown(wait=wait)
