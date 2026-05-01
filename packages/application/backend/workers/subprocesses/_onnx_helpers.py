"""Shared ONNX model loading helper — used by subprocess initializers."""
from __future__ import annotations

import logging
from pathlib import Path

logger = logging.getLogger(__name__)


def load_onnx_model(model_path: str | Path):
    """Load an ONNX model from disk. Returns an ort.InferenceSession."""
    import onnxruntime as ort

    path = Path(model_path)
    if not path.exists():
        raise FileNotFoundError(f"Model file not found: {path}")

    logger.info("Loading ONNX model: %s", path.name)
    session = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
    return session
