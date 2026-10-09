import asyncio
import time

import pytest
from backend.workers.worker_pool import WorkerPool


def _double(x):
    return x * 2


def _sleep_then(x, seconds=30.0):
    time.sleep(seconds)
    return x


@pytest.mark.asyncio
async def test_run_trivial_function():
    pool = WorkerPool(max_workers=1)
    try:
        result = await pool.run(_double, 21)
        assert result == 42
    finally:
        pool.shutdown(wait=True)


@pytest.mark.asyncio
async def test_shutdown():
    pool = WorkerPool(max_workers=1)
    pool.shutdown(wait=True)


@pytest.mark.asyncio
async def test_force_stop_kills_inflight_and_recreates_pool():
    pool = WorkerPool(max_workers=1)
    try:
        task = asyncio.create_task(pool.run(_sleep_then, 1, 30.0))
        # Give the worker process time to start the sleep.
        await asyncio.sleep(0.5)

        started = time.monotonic()
        pool.force_stop()
        with pytest.raises(asyncio.CancelledError):
            await task
        elapsed = time.monotonic() - started
        assert elapsed < 5.0, f"force_stop took too long: {elapsed:.1f}s"

        # Pool must be usable again after recreate.
        assert await pool.run(_double, 3) == 6
    finally:
        pool.shutdown(wait=True)
