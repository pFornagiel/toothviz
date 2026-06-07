from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from pathlib import Path

from backend.config import SEGMENTATION_MODE
from backend.workers.steps.base import (
    OutputArtifact,
    StepContext,
    StepResult,
    WORKER_POOL_SEGMENTATION,
)
from backend.workers.steps.configs import SegmentNiftiStepConfig

if SEGMENTATION_MODE == "dummy":
    from backend.workers.subprocesses.segmentation_fn_dummy import (
        run_segmentation,
    )
else:
    from backend.workers.subprocesses.segmentation_fn import run_segmentation

logger = logging.getLogger(__name__)


def _drain_progress_queue(queue) -> tuple[int, int] | None:
    """Drain all available items; return the latest (done, total) patch counts."""
    latest: tuple[int, int] | None = None
    if queue is None:
        return None
    while True:
        try:
            item = queue.get_nowait()
        except Exception:
            break
        try:
            done, total = item
            latest = (int(done), int(total))
        except Exception:
            continue
    return latest


@dataclass
class SegmentNiftiStep:
    name: str = "segment_nifti"
    config: SegmentNiftiStepConfig = field(default_factory=SegmentNiftiStepConfig)

    async def run(self, ctx: StepContext) -> StepResult:
        logger.info(f"Starting segmentation step '{self.name}' for job {ctx.job_id}")
        out_dir = ctx.work_dir / "segmentation_output"
        out_dir.mkdir(parents=True, exist_ok=True)

        progress_queue = None
        manager = None
        try:
            import multiprocessing

            manager = multiprocessing.Manager()
            progress_queue = manager.Queue()
        except Exception:
            progress_queue = None
            manager = None

        stop_evt = asyncio.Event()

        async def progress_pump() -> None:
            last_emit = 0.0
            last_done: int | None = None
            try:
                while not stop_evt.is_set():
                    counts = _drain_progress_queue(progress_queue)
                    if counts is not None:
                        done, total = counts
                        now = time.monotonic()
                        if (
                            last_done is None
                            or done >= total
                            or (now - last_emit) >= 0.5
                        ):
                            last_emit = now
                            last_done = done
                            step_progress = done / total if total > 0 else 0.0
                            await ctx.broadcast_progress(
                                step_name=self.name,
                                step_progress=step_progress,
                                chunk_index=done - 1,
                                total_chunks=total,
                            )
                    await asyncio.sleep(0.1)
            except Exception:
                return

        pump_task = asyncio.create_task(progress_pump())
        try:
            mask_path_str: str = await ctx.run_in_worker_pool(
                WORKER_POOL_SEGMENTATION,
                run_segmentation,
                str(ctx.current_input_path),
                str(out_dir),
                self.config,
                progress_queue,
            )
        finally:
            stop_evt.set()
            try:
                await pump_task
            except Exception:
                pass
            try:
                if manager is not None:
                    manager.shutdown()
            except Exception:
                pass

        mask_path = Path(mask_path_str)
        logger.info(f"Segmentation step '{self.name}' completed for job {ctx.job_id}")

        return StepResult(
            next_input_path=ctx.current_input_path,
            artifacts=[
                OutputArtifact(
                    path=mask_path,
                    kind="segmentation_mask",
                    purpose="viewer_overlay",
                ),
            ],
        )
