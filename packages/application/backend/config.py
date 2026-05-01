from pathlib import Path

_BACKEND_DIR = Path(__file__).parent
_APPLICATION_ROOT = _BACKEND_DIR.parent
_REPO_ROOT = _APPLICATION_ROOT.parent.parent

DEFAULT_CHUNK_SIZE: int = 16 * 1024 * 1024  # 16 MB

DATA_ROOT: Path = _APPLICATION_ROOT / "data"

STORAGE_DB_URL: str = f"sqlite:///{DATA_ROOT / 'cbct.db'}"

MODEL_PATH: Path = _REPO_ROOT / "packages" / "models" / "railnet_dental.onnx"

# Passed to onnxruntime; override via env in the future if needed.
ONNX_EXECUTION_PROVIDERS: tuple[str, ...] = ("CPUExecutionProvider",)

CAS_BLOB_HASH_LENGTH = 2