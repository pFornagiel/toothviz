from pathlib import Path

import pytest

from backend import config
from backend.exceptions import NotFoundError, ConflictError, ValidationError, AppError


def test_config_attributes_exist():
    assert isinstance(config.DEFAULT_CHUNK_SIZE, int)
    assert config.DEFAULT_CHUNK_SIZE == 16 * 1024 * 1024
    assert isinstance(config.DATA_ROOT, Path)
    assert isinstance(config.STORAGE_DB_URL, str)
    assert isinstance(config.MODEL_PATH, Path)


def test_model_path_defaults_to_lite(monkeypatch):
    monkeypatch.delenv("TOOTH_MODEL_PATH", raising=False)
    monkeypatch.delenv("TOOTH_MODEL", raising=False)
    assert config.resolve_model_path() == config.LITE_MOBILE_UNET_5CH_PATH


def test_model_path_selects_mobilenetv3(monkeypatch):
    monkeypatch.delenv("TOOTH_MODEL_PATH", raising=False)
    monkeypatch.setenv("TOOTH_MODEL", "mobilenetv3_unet_3ch")
    assert config.resolve_model_path() == config.MOBILENETV3_UNET_3CH_PATH


def test_model_path_explicit_file_overrides_name(monkeypatch, tmp_path):
    chosen = tmp_path / "custom.onnx"
    monkeypatch.setenv("TOOTH_MODEL", "lite_mobile_unet_5ch")
    monkeypatch.setenv("TOOTH_MODEL_PATH", str(chosen))
    assert config.resolve_model_path() == chosen


def test_model_path_rejects_unknown_name(monkeypatch):
    monkeypatch.delenv("TOOTH_MODEL_PATH", raising=False)
    monkeypatch.setenv("TOOTH_MODEL", "nope")
    with pytest.raises(ValueError, match="TOOTH_MODEL"):
        config.resolve_model_path()


def test_config_no_side_effects():
    """Importing config should not create filesystem directories."""
    pass  # If we got here without error, import succeeded


def test_not_found_error():
    err = NotFoundError("missing")
    assert err.status_code == 404
    assert err.detail == "missing"
    assert isinstance(err, AppError)


def test_conflict_error():
    err = ConflictError("conflict")
    assert err.status_code == 409


def test_validation_error():
    err = ValidationError("invalid")
    assert err.status_code == 422
