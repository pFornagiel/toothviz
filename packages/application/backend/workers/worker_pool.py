from __future__ import annotations

import asyncio
from concurrent.futures import ProcessPoolExecutor
from typing import Any, Callable


class WorkerPool:
    """Generic wrapper around ProcessPoolExecutor."""

    def __init__(
        self,
        max_workers: int = 1,
        initializer: Callable | None = None,
        initargs: tuple = (),
    ) -> None:
        self._pool = ProcessPoolExecutor(
            max_workers=max_workers,
            initializer=initializer,
            initargs=initargs,
        )

    async def run(self, fn: Callable, *args: Any) -> Any:
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(self._pool, fn, *args)

    def shutdown(self, wait: bool = False) -> None:
        self._pool.shutdown(wait=wait)
