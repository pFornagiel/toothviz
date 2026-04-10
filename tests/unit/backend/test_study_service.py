import pytest

from backend.db.models import Blob
from backend.db.repos.file_repo import FileRepo
from backend.services.study_service import StudyService


@pytest.fixture()
def study_service(storage_service):
    return StudyService(storage_service, job_pipeline_service=None)


def test_create_study(study_service, storage_service):
    study = study_service.create(name="My Study")
    assert study.name == "My Study"
    assert study.status == "created"

    study_dir = storage_service.engine.root / "studies" / study.id
    assert (study_dir / "raw").is_dir()
    assert (study_dir / "derived").is_dir()


def test_create_study_with_external_id(study_service):
    study = study_service.create(external_id="EXT-1", name="Ext")
    assert study.external_id == "EXT-1"


def test_list_studies(study_service):
    study_service.create(name="A")
    study_service.create(name="B")
    study_service.create(name="C")

    studies = study_service.list()
    assert len(studies) == 3


def test_list_studies_filter_external_id(study_service):
    study_service.create(name="A", external_id="e1")
    study_service.create(name="B", external_id="e2")

    results = study_service.list(external_id="e1")
    assert len(results) == 1
    assert results[0].name == "A"


def test_rename_study(study_service):
    study = study_service.create(name="Old")
    renamed = study_service.rename(study.id, "New")
    assert renamed.name == "New"


def test_delete_study_removes_files_and_dirs(
    study_service, storage_service, session_factory,
):
    study = study_service.create(name="to-delete")

    storage_service.engine.initialize_upload("u1")
    storage_service.engine.write_chunk("u1", 0, b"data")
    storage_service.store_original(
        "u1", study.id, "file.nii", "nifti_raw", None, None, None,
    )

    study_service.delete(study.id)

    study_dir = storage_service.engine.root / "studies" / study.id
    assert not study_dir.exists()


def test_delete_study_with_null_pipeline_service(study_service):
    study = study_service.create(name="safe-delete")
    study_service.delete(study.id)  # should not raise
