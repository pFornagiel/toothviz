from __future__ import annotations

import logging
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from backend.config import SEGMENTATION_MODE, MODEL_PATH
from backend.workers.steps.base import (
    OutputArtifact,
    StepContext,
    StepResult,
    WORKER_POOL_SEGMENTATION,
)
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
    config: dict[str, Any] | None = None

    def __post_init__(self):
        if not self.config:
            # Default to the config tied to the globally configured MODEL_PATH
            json_path = MODEL_PATH.with_suffix(".json")
            if json_path.exists():
                logger.info(f"Loading pipeline config for model from {json_path}")
                with open(json_path, "r", encoding="utf-8") as f:
                    self.config = json.load(f)
            else:
                logger.warning(f"No JSON config found for model at {json_path}, using empty config")
                self.config = {}

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
