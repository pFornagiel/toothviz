from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from backend.workers.steps.base import OutputArtifact, StepContext, StepResult
from backend.workers.subprocesses.dicom_fn import convert_dicom


@dataclass
class DicomToNiftiStep:
    name: str = "dicom_to_nifti"
    config: dict = field(default_factory=dict)

    async def run(self, ctx: StepContext) -> StepResult:
        out_dir = ctx.work_dir / "dicom_output"
        out_dir.mkdir(parents=True, exist_ok=True)

        nifti_path_str: str = await ctx.run_subprocess(
            convert_dicom,
            str(ctx.current_input_path),
            str(out_dir),
        )
        nifti_path = Path(nifti_path_str)

        await ctx.broadcaster.broadcast(ctx.job_id, {
            "step": self.name,
            "status": "completed",
        })

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
