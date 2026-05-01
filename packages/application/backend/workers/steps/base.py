from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Protocol

from backend.workers.worker_pool import WorkerPool
from backend.workers.ws_broadcaster import WSBroadcaster


# Registered keys for `StepContext.worker_pools` — must exist at app bootstrap.
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

    async def run_in_worker_pool(
        self, pool_name: str, fn: Callable, *args: Any
    ) -> Any:
        try:
            pool = self.worker_pools[pool_name]
        except KeyError as exc:
            raise KeyError(
                f"Unknown worker pool {pool_name!r}; configured pools: "
                f"{sorted(self.worker_pools.keys())}"
            ) from exc
        return await pool.run(fn, *args)


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
