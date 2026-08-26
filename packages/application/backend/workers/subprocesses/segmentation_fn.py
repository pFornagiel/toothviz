"""Modular ML inference entrypoint.

Runs in a subprocess via WorkerPool. 
The model is loaded once per worker process via _init_segmentation().
"""

from __future__ import annotations

import logging
from typing import Any

from backend.workers.subprocesses._onnx_helpers import load_onnx_model
from backend.workers.subprocesses.ml_pipeline import run_pipeline

logger = logging.getLogger(__name__)

_model = None


def _init_segmentation(model_path: str, execution_providers: tuple[str, ...]) -> None:
    """Process-level initializer - called once per worker process."""
    global _model

    from backend.logging import setup_logging
    setup_logging("segmentation_worker")

    providers = list(execution_providers) if execution_providers else None
    _model = load_onnx_model(model_path, providers=providers)


def run_segmentation(
    input_nifti_path: str,
    out_dir: str,
    config: dict[str, Any],
    progress_queue=None,
) -> str:
    """Run segmentation inference using the modular pipeline."""
    if _model is None:
        raise RuntimeError(
            "segmentation model not initialized - call _init_segmentation first"
        )

    return run_pipeline(
        input_nifti_path=input_nifti_path,
        out_dir=out_dir,
        config=config,
        model_session=_model,
        progress_queue=progress_queue,
    )
