from __future__ import annotations

import shutil
from dataclasses import dataclass
from pathlib import Path

from dicomanonymizer.simpledicomanonymizer import anonymizeDICOMFile
from pydicom.misc import is_dicom

from backend.utils.dicom_zip import resolve_dicom_input_root, zip_directory
from backend.workers.steps.base import StepContext, StepResult


@dataclass
class AnonymiseDicomStep:
    name: str = "anonymyse_dicom"

    async def run(self, ctx: StepContext) -> StepResult:
        inp = ctx.current_input_path
        root = resolve_dicom_input_root(inp, ctx.work_dir / "anonymize_zip_extract")

        if root.is_file():
            dicoms = [root] if is_dicom(root) else []
            rel_base = inp.parent  # lone file stays flat under ``out``
        else:
            dicoms = sorted(p for p in root.rglob("*") if p.is_file() and is_dicom(p))
            rel_base = root

        if not dicoms:
            raise ValueError(f"No DICOM files found under {root}")

        out_zipped = ctx.work_dir / "anonymized_dicom"
        shutil.rmtree(out_zipped, ignore_errors=True)
        out_zipped.mkdir(parents=True, exist_ok=True)

        outs: list[Path] = []
        for src in dicoms:
            dest = out_zipped / src.relative_to(rel_base)
            dest.parent.mkdir(parents=True, exist_ok=True)
            anonymizeDICOMFile(str(src), str(dest))
            outs.append(dest)

        if len(outs) == 1:
            next_path = outs[0]
        else:
            bundle_zip = ctx.work_dir / "anonymized_bundle.zip"
            next_path = zip_directory(out_zipped, bundle_zip)

        await ctx.broadcaster.broadcast(
            ctx.job_id,
            {
                "event": "step_completed",
                "job_id": ctx.job_id,
                "step": self.name,
                "status": "completed",
            },
        )

        return StepResult(next_input_path=next_path, artifacts=[])
