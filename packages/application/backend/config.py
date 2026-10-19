import os
from pathlib import Path

_BACKEND_DIR = Path(__file__).parent
_APPLICATION_ROOT = _BACKEND_DIR.parent
_REPO_ROOT = _APPLICATION_ROOT.parent.parent

DEFAULT_CHUNK_SIZE: int = 16 * 1024 * 1024  # 16 MB

_DEFAULT_DATA_ROOT = _APPLICATION_ROOT / "data"
_MODELS_DIR = _REPO_ROOT / "packages" / "models"
_DEFAULT_FRONTEND_DIST = _APPLICATION_ROOT / "frontend" / "dist"

LITE_MOBILE_UNET_5CH_PATH: Path = (
    _MODELS_DIR / "lite_mobile_unet_5ch" / "exports" / "lite_mobile_unet_5ch.onnx"
)
MOBILENETV3_UNET_3CH_PATH: Path = (
    _MODELS_DIR / "mobilenetv3_unet_3ch" / "exports" / "mobilenetv3_unet_3ch.onnx"
)

# Selected with TOOTH_MODEL. lite_mobile_unet_5ch is the default.
MODEL_PATHS: dict[str, Path] = {
    "lite_mobile_unet_5ch": LITE_MOBILE_UNET_5CH_PATH,
    "mobilenetv3_unet_3ch": MOBILENETV3_UNET_3CH_PATH,
}
DEFAULT_MODEL_NAME = "lite_mobile_unet_5ch"


def resolve_model_path() -> Path:
    """ONNX file for this process.

    ``TOOTH_MODEL_PATH`` is an explicit file and wins. Otherwise ``TOOTH_MODEL``
    picks a name from ``MODEL_PATHS``.
    """
    explicit = os.getenv("TOOTH_MODEL_PATH")
    if explicit:
        return Path(explicit)
    name = os.getenv("TOOTH_MODEL", DEFAULT_MODEL_NAME)
    try:
        return MODEL_PATHS[name]
    except KeyError:
        known = ", ".join(MODEL_PATHS)
        raise ValueError(f"Invalid TOOTH_MODEL: {name!r}. Must be one of: {known}") from None


DATA_ROOT: Path = Path(os.getenv("TOOTH_DATA_ROOT", str(_DEFAULT_DATA_ROOT)))

STORAGE_DB_URL: str = f"sqlite:///{DATA_ROOT / 'cbct.db'}"

MODEL_PATH: Path = resolve_model_path()

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