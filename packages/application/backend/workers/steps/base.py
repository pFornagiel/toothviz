from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Protocol

from backend.workers.worker_pool import WorkerPool
from backend.workers.ws_broadcaster import WSBroadcaster


@dataclass
class StepContext:
    job_id: str
    study_id: str
    current_input_path: Path
    work_dir: Path
    broadcaster: WSBroadcaster
    _dicom_worker_pool: WorkerPool = field(repr=False)
    _segmentation_worker_pool: WorkerPool = field(repr=False)

    async def run_dicom_subprocess(self, fn: Callable, *args: Any) -> Any:
        return await self._dicom_worker_pool.run(fn, *args)

    async def run_segmentation_subprocess(self, fn: Callable, *args: Any) -> Any:
        return await self._segmentation_worker_pool.run(fn, *args)


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
