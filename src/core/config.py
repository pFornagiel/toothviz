from pathlib import Path

CORE_DIR = Path(__file__).parent
SRC_DIR = CORE_DIR.parent
PROJECT_ROOT = SRC_DIR.parent

DATA_DIR = PROJECT_ROOT / "data"
LOG_DIR = PROJECT_ROOT / "logs"
MODEL_PATH = PROJECT_ROOT / "assets" / "models" / "railnet_dental.onnx"

# Ensure directories exist
DATA_DIR.mkdir(parents=True, exist_ok=True)
LOG_DIR.mkdir(parents=True, exist_ok=True)

STORAGE_DB_URL = f"sqlite:///{DATA_DIR}/storage.sqlite3"

