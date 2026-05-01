from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from backend.workers.steps.base import OutputArtifact, StepContext, StepResult
from backend.workers.steps.step_config import SegmentNiftiStepConfig
from backend.workers.subprocesses.segmentation_fn import run_segmentation


@dataclass
class SegmentNiftiStep:
    name: str = "segment_nifti"
    config: SegmentNiftiStepConfig = field(default_factory=SegmentNiftiStepConfig)

    async def run(self, ctx: StepContext) -> StepResult:
        out_dir = ctx.work_dir / "segmentation_output"
        out_dir.mkdir(parents=True, exist_ok=True)

        mask_path_str: str = await ctx.run_segmentation_subprocess(
            run_segmentation,
            str(ctx.current_input_path),
            str(out_dir),
            self.config.threshold,
            self.config.pad_multiple,
        )
        mask_path = Path(mask_path_str)

        await ctx.broadcaster.broadcast(
            ctx.job_id,
            {
                "event": "step_completed",
                "job_id": ctx.job_id,
                "step": self.name,
                "status": "completed",
            },
        )

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
