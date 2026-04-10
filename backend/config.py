from pathlib import Path

_BACKEND_DIR = Path(__file__).parent
_PROJECT_ROOT = _BACKEND_DIR.parent

DEFAULT_CHUNK_SIZE: int = 16 * 1024 * 1024  # 16 MB

DATA_ROOT: Path = _PROJECT_ROOT / "data"

STORAGE_DB_URL: str = f"sqlite:///{DATA_ROOT / 'cbct.db'}"

MODEL_PATH: Path = _PROJECT_ROOT / "assets" / "models" / "railnet_dental.onnx"

CAS_BLOB_HASH_LENGTH = 2