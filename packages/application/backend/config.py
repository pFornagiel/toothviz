import os
from pathlib import Path

_BACKEND_DIR = Path(__file__).parent
_APPLICATION_ROOT = _BACKEND_DIR.parent
_REPO_ROOT = _APPLICATION_ROOT.parent.parent

DEFAULT_CHUNK_SIZE: int = 16 * 1024 * 1024  # 16 MB

DATA_ROOT: Path = _APPLICATION_ROOT / "data"

STORAGE_DB_URL: str = f"sqlite:///{DATA_ROOT / 'cbct.db'}"

SEGMENTATION_MODE: str = os.getenv("SEGMENTATION_MODE", "normal").lower()
if SEGMENTATION_MODE not in ("normal", "dummy"):
    raise ValueError(
        f"Invalid SEGMENTATION_MODE: {SEGMENTATION_MODE!r}. "
        f"Must be 'normal' or 'dummy'"
    )

MODEL_PATH: Path = _REPO_ROOT / "packages" / "models" / "tooth_seg_semantic.onnx"

ONNX_EXECUTION_PROVIDERS: tuple[str, ...] = ("CPUExecutionProvider",)

CAS_BLOB_HASH_LENGTH = 2