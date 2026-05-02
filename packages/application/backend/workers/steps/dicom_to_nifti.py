from __future__ import annotations

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


@dataclass
class DicomToNiftiStep:
    name: str = "dicom_to_nifti"
    config: DicomToNiftiStepConfig = field(default_factory=DicomToNiftiStepConfig)

    async def run(self, ctx: StepContext) -> StepResult:
        out_dir = ctx.work_dir / "dicom_output"
        out_dir.mkdir(parents=True, exist_ok=True)

        nifti_path_str: str = await ctx.run_in_worker_pool(
            WORKER_POOL_DICOM,
            convert_dicom,
            str(ctx.current_input_path),
            str(out_dir),
            self.config.max_zip_members,
            self.config.max_uncompressed_zip_bytes,
        )
        nifti_path = Path(nifti_path_str)

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
            next_input_path=nifti_path,
            artifacts=[
                OutputArtifact(
                    path=nifti_path,
                    kind="nifti_derived",
                    purpose="viewer_volume",
                ),
            ],
        )
