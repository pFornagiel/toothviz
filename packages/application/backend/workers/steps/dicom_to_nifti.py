from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from pathlib import Path

from backend.workers.steps.base import (
    OutputArtifact,
    StepContext,
    StepResult,
    WORKER_POOL_DICOM,
)
from backend.workers.steps.configs import DicomToNiftiStepConfig
from backend.workers.subprocesses.dicom_fn import convert_dicom

logger = logging.getLogger(__name__)


def _drain_progress_queue(queue) -> float | None:
    latest: float | None = None
    if queue is None:
        return None
    while True:
        try:
            item = queue.get_nowait()
        except Exception:
            break
        try:
            latest = float(item)
        except Exception:
            continue
    return latest


@dataclass
class DicomToNiftiStep:
    name: str = "dicom_to_nifti"
    config: DicomToNiftiStepConfig = field(default_factory=DicomToNiftiStepConfig)

    async def run(self, ctx: StepContext) -> StepResult:
        out_dir = ctx.work_dir / "dicom_output"
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
            last_value: float | None = None
            try:
                while not stop_evt.is_set():
                    v = _drain_progress_queue(progress_queue)
                    if v is not None:
                        now = time.monotonic()
                        if last_value is None or v >= 1.0 or (now - last_emit) >= 0.5:
                            last_emit = now
                            last_value = v
                            await ctx.broadcast_progress(
                                step_name=self.name,
                                step_progress=v,
                            )
                    await asyncio.sleep(0.1)
            except Exception:
                return

        pump_task = asyncio.create_task(progress_pump())
        try:
            nifti_path_str: str = await ctx.run_in_worker_pool(
                WORKER_POOL_DICOM,
                convert_dicom,
                str(ctx.current_input_path),
                str(out_dir),
                self.config.max_zip_members,
                self.config.max_uncompressed_zip_bytes,
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

        nifti_path = Path(nifti_path_str)

        return StepResult(
            next_input_path=nifti_path,
            artifacts=[
                OutputArtifact(
                    path=nifti_path,
                    kind="nifti_derived",
                    purpose="viewer_volume",
                ),
            ],
        )
