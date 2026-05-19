import os
from pathlib import Path

_BACKEND_DIR = Path(__file__).parent
_APPLICATION_ROOT = _BACKEND_DIR.parent
_REPO_ROOT = _APPLICATION_ROOT.parent.parent

DEFAULT_CHUNK_SIZE: int = 16 * 1024 * 1024  # 16 MB

_DEFAULT_DATA_ROOT = _APPLICATION_ROOT / "data"
_DEFAULT_MODEL_PATH = _REPO_ROOT / "packages" / "models" / "tooth_seg_semantic.onnx"
_DEFAULT_FRONTEND_DIST = _APPLICATION_ROOT / "frontend" / "dist"

DATA_ROOT: Path = Path(os.getenv("TOOTH_DATA_ROOT", str(_DEFAULT_DATA_ROOT)))

STORAGE_DB_URL: str = f"sqlite:///{DATA_ROOT / 'cbct.db'}"

MODEL_PATH: Path = Path(os.getenv("TOOTH_MODEL_PATH", str(_DEFAULT_MODEL_PATH)))

FRONTEND_DIST: Path = Path(
    os.getenv("TOOTH_FRONTEND_DIST", str(_DEFAULT_FRONTEND_DIST))
)

SERVE_FRONTEND: bool = os.getenv("TOOTH_SERVE_FRONTEND", "").lower() in (
    "1",
    "true",
    "yes",
)

SEGMENTATION_MODE: str = os.getenv("SEGMENTATION_MODE", "normal").lower()
if SEGMENTATION_MODE not in ("normal", "dummy"):
    raise ValueError(
        f"Invalid SEGMENTATION_MODE: {SEGMENTATION_MODE!r}. "
        f"Must be 'normal' or 'dummy'"
    )

ONNX_EXECUTION_PROVIDERS: tuple[str, ...] = ("CPUExecutionProvider",)

BACKEND_HOST: str = os.getenv("TOOTH_BACKEND_HOST", "127.0.0.1")
BACKEND_PORT: int = int(os.getenv("TOOTH_BACKEND_PORT", "17890"))

CAS_BLOB_HASH_LENGTH = 2