from pathlib import Path

CORE_DIR = Path(__file__).parent
_PROTOTYPING_ROOT = CORE_DIR.parent
_REPO_ROOT = _PROTOTYPING_ROOT.parent.parent
_APPLICATION_ROOT = _REPO_ROOT / "packages" / "application"

DATA_DIR = _APPLICATION_ROOT / "data"
LOG_DIR = _APPLICATION_ROOT / "logs"
MODEL_PATH = _REPO_ROOT / "packages" / "models" / "railnet_dental.onnx"

# Ensure directories exist
DATA_DIR.mkdir(parents=True, exist_ok=True)
LOG_DIR.mkdir(parents=True, exist_ok=True)

STORAGE_DB_URL = f"sqlite:///{DATA_DIR}/storage.sqlite3"

