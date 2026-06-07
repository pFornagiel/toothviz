from __future__ import annotations

import logging
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
from backend.workers.steps.progress_queue import parse_patch_progress, run_with_progress_pump

if SEGMENTATION_MODE == "dummy":
    from backend.workers.subprocesses.segmentation_fn_dummy import (
        run_segmentation,
    )
else:
    from backend.workers.subprocesses.segmentation_fn import run_segmentation

logger = logging.getLogger(__name__)


@dataclass
class SegmentNiftiStep:
    name: str = "segment_nifti"
    config: SegmentNiftiStepConfig = field(default_factory=SegmentNiftiStepConfig)

    async def run(self, ctx: StepContext) -> StepResult:
        logger.info(f"Starting segmentation step '{self.name}' for job {ctx.job_id}")
        out_dir = ctx.work_dir / "segmentation_output"
        out_dir.mkdir(parents=True, exist_ok=True)

        async def _segment(progress_queue) -> str:
            return await ctx.run_in_worker_pool(
                WORKER_POOL_SEGMENTATION,
                run_segmentation,
                str(ctx.current_input_path),
                str(out_dir),
                self.config,
                progress_queue,
            )

        mask_path_str = await run_with_progress_pump(
            ctx,
            self.name,
            _segment,
            parse_item=parse_patch_progress,
        )
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
