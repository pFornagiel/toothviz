from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Protocol

from backend.workers.worker_pool import WorkerPool
from backend.workers.ws_broadcaster import WSBroadcaster


# Registered keys for `StepContext.worker_pools` - must exist at app bootstrap.
WORKER_POOL_DICOM = "dicom"
WORKER_POOL_SEGMENTATION = "segmentation"


@dataclass
class StepContext:
    job_id: str
    study_id: str
    current_input_path: Path
    work_dir: Path
    broadcaster: WSBroadcaster
    worker_pools: dict[str, WorkerPool] = field(repr=False)
    step_index: int | None = None
    total_steps: int | None = None

    async def run_in_worker_pool(self, pool_name: str, fn: Callable, *args: Any) -> Any:
        try:
            pool = self.worker_pools[pool_name]
        except KeyError:
            known = ", ".join(sorted(self.worker_pools))
            raise KeyError(
                f"{pool_name} not in worker_pools; known pools: {known}"
            ) from None
        return await pool.run(fn, *args)

    async def broadcast_progress(
        self,
        *,
        step_name: str,
        step_progress: float | None,
    ) -> None:
        """Broadcast a `step_progress` frame with overall pipeline progress in [0, 1]."""
        if self.total_steps is None or self.step_index is None or self.total_steps <= 0:
            return

        sp = 0.0 if step_progress is None else float(step_progress)
        sp = max(0.0, min(1.0, sp))
        overall = (self.step_index + sp) / self.total_steps
        overall = max(0.0, min(1.0, overall))

        await self.broadcaster.broadcast(
            self.job_id,
            {
                "event": "step_progress",
                "job_id": self.job_id,
                "status": "running",
                "step": step_name,
                "step_index": self.step_index,
                "total_steps": self.total_steps,
                "progress": overall,
                "step_progress": sp,
            },
        )


@dataclass
class OutputArtifact:
    path: Path
    kind: str
    purpose: str


@dataclass
class StepResult:
    next_input_path: Path
    artifacts: list[OutputArtifact]


class PipelineStep(Protocol):
    name: str

    async def run(self, ctx: StepContext) -> StepResult: ...


StepFactory = Callable[[dict], PipelineStep]
