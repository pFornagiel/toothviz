import pytest
from backend.workers.worker_pool import WorkerPool


def _double(x):
    return x * 2


@pytest.mark.asyncio
async def test_run_trivial_function():
    pool = WorkerPool(max_workers=1)
    try:
        result = await pool.run(_double, 21)
        assert result == 42
    finally:
        pool.shutdown(wait=True)


def _read_global():
    return _GLOBAL_VAL


_GLOBAL_VAL = None


def _set_global(val):
    global _GLOBAL_VAL
    _GLOBAL_VAL = val


@pytest.mark.asyncio
async def test_shutdown():
    pool = WorkerPool(max_workers=1)
    pool.shutdown(wait=True)
