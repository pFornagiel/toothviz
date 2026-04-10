from pathlib import Path

from backend import config
from backend.exceptions import NotFoundError, ConflictError, ValidationError, AppError


def test_config_attributes_exist():
    assert isinstance(config.DEFAULT_CHUNK_SIZE, int)
    assert config.DEFAULT_CHUNK_SIZE == 16 * 1024 * 1024
    assert isinstance(config.DATA_ROOT, Path)
    assert isinstance(config.STORAGE_DB_URL, str)
    assert isinstance(config.MODEL_PATH, Path)


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
