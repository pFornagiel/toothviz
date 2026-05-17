from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass

from backend.workers.steps.base import OutputArtifact, StepContext, StepResult

logger = logging.getLogger(__name__)


@dataclass
class StubStep:
    name: str = "stub"

    async def run(self, ctx: StepContext) -> StepResult:
        logger.info(f"Starting StubStep for job {ctx.job_id} (simulating work for 2s)")
        await asyncio.sleep(2)
        logger.info(f"Finished StubStep for job {ctx.job_id}")
        return StepResult(
            next_input_path=ctx.current_input_path,
            artifacts=[],
        )


@dataclass
class PassthroughViewerStep:
    name: str = "passthrough"

    async def run(self, ctx: StepContext) -> StepResult:
        logger.info(f"Starting PassthroughViewerStep for job {ctx.job_id}")
        
        return StepResult(
            next_input_path=ctx.current_input_path,
            artifacts=[
                OutputArtifact(
                    path=ctx.current_input_path,
                    kind="nifti_raw",
                    purpose="viewer_volume",
                )
            ],
        )
