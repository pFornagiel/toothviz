"""Backend-specific test fixtures."""

import pytest
from unittest.mock import MagicMock

from backend.storage.local_engine import LocalStorageEngine
from backend.services.storage_service import StorageService
from backend.db.repos.study_repo import StudyRepo
from backend.db.repos.pipeline_job_repo import PipelineJobRepo


@pytest.fixture()
def storage_engine(tmp_data_root):
    return LocalStorageEngine(tmp_data_root)


@pytest.fixture()
def storage_service(storage_engine, session_factory):
    return StorageService(storage_engine, session_factory)


@pytest.fixture()
def make_study(db_session, storage_engine):
    """Factory fixture that inserts a Study and its singleton PipelineJob."""
    def _make(name=None):
        study = StudyRepo(db_session).create(name=name)
        PipelineJobRepo(db_session).create_for_study(study.id)
        return study
    return _make
