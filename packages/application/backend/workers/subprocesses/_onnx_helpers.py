"""Shared ONNX model loading helper - used by subprocess initializers."""
from __future__ import annotations

import logging
from pathlib import Path

logger = logging.getLogger(__name__)


def load_onnx_model(model_path: str | Path, providers: list[str] | None = None):
    """Load an ONNX model from disk. Returns an ort.InferenceSession."""
    import onnxruntime as ort

    path = Path(model_path)
    if not path.exists():
        raise FileNotFoundError(f"Model file not found: {path}")

    sess_providers = providers if providers else ["CPUExecutionProvider"]

    opts = ort.SessionOptions()
    opts.enable_cpu_mem_arena = False 
    opts.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
        
    logger.info("Loading ONNX model: %s", path.name)
    session = ort.InferenceSession(str(path), sess_options=opts, providers=sess_providers)
    return session
    