"""Backend-specific test fixtures."""

import pytest
from unittest.mock import MagicMock

from backend.storage.local_engine import LocalStorageEngine
from backend.services.storage_service import StorageService
from backend.db.models import Study
from backend.db.repos.study_repo import StudyRepo


@pytest.fixture()
def storage_engine(tmp_data_root):
    return LocalStorageEngine(tmp_data_root)


@pytest.fixture()
def storage_service(storage_engine, session_factory):
    return StorageService(storage_engine, session_factory)


@pytest.fixture()
def make_study(db_session, storage_engine):
    """Factory fixture that inserts a Study and creates its directories."""
    def _make(name=None, external_id=None, meta=None):
        study = StudyRepo(db_session).create(name=name, external_id=external_id, meta=meta)
        study_dir = storage_engine.root / "studies" / study.id
        (study_dir / "raw").mkdir(parents=True, exist_ok=True)
        (study_dir / "derived").mkdir(parents=True, exist_ok=True)
        return study
    return _make
