import pytest

from backend.db.models import Study, FileRecord
from backend.db.repos.study_repo import StudyRepo
from backend.db.repos.upload_session_repo import UploadSessionRepo
from backend.db.repos.file_repo import FileRepo
from backend.db.repos.pipeline_job_repo import PipelineJobRepo
from backend.exceptions import NotFoundError


# -- Study --

def test_study_crud(db_session):
    repo = StudyRepo(db_session)
    study = repo.create(name="S1")
    assert study.name == "S1"

    fetched = repo.get(study.id)
    assert fetched.name == "S1"

    listed = repo.list()
    assert len(listed) == 1

    renamed = repo.rename(study.id, "S2")
    assert renamed.name == "S2"

    repo.delete(study.id)
    with pytest.raises(NotFoundError):
        repo.get(study.id)


def test_study_list_filter_name(db_session):
    repo = StudyRepo(db_session)
    repo.create(name="A")
    repo.create(name="B")

    results = repo.list(name="A")
    assert len(results) == 1
    assert results[0].name == "A"


# -- UploadSession --

def test_upload_session_crud(db_session):
    db_session.add(Study(id="s1"))
    db_session.commit()

    repo = UploadSessionRepo(db_session)
    session = repo.create("s1", "file.nii", "nifti_raw")
    assert session.state == "active"

    fetched = repo.get(session.id)
    assert fetched.filename == "file.nii"

    repo.update_state(session.id, "finalized")
    assert repo.get(session.id).state == "finalized"


def test_upload_session_list_by_state(db_session):
    db_session.add(Study(id="s1"))
    db_session.commit()

    repo = UploadSessionRepo(db_session)
    repo.create("s1", "a.nii", "nifti_raw")
    s2 = repo.create("s1", "b.nii", "nifti_raw")
    repo.update_state(s2.id, "aborted")

    active = repo.list_by_state("active")
    assert len(active) == 1

    aborted = repo.list_by_state("aborted")
    assert len(aborted) == 1


# -- FileRepo --

def _setup_study_with_files(db_session):
    db_session.add(Study(id="s1"))
    db_session.commit()


def test_file_repo_create_and_list(db_session):
    _setup_study_with_files(db_session)
    repo = FileRepo(db_session)

    repo.create_file_record(
        file_id="f1",
        study_id="s1", kind="nifti_raw",
        viewer_purpose="viewer_volume", display_name="v.nii",
        blob_hash="a" * 64, size=100,
    )
    repo.create_file_record(
        file_id="f2",
        study_id="s1", kind="segmentation_mask",
        viewer_purpose="viewer_overlay", display_name="m.nii",
        blob_hash="a" * 64, size=100,
    )

    all_files = repo.list_by_study("s1")
    assert len(all_files) == 2

    volumes = repo.list_by_study("s1", viewer_purpose_filter=["viewer_volume"])
    assert len(volumes) == 1


def test_file_repo_clear_viewer_purpose(db_session):
    _setup_study_with_files(db_session)
    repo = FileRepo(db_session)

    repo.create_file_record(
        file_id="f1",
        study_id="s1", kind="nifti_raw",
        viewer_purpose="viewer_volume", display_name="old.nii",
        blob_hash="a" * 64, size=100,
    )
    repo.clear_viewer_purpose("s1", "viewer_volume")

    repo.create_file_record(
        file_id="f2",
        study_id="s1", kind="nifti_raw",
        viewer_purpose="viewer_volume", display_name="new.nii",
        blob_hash="a" * 64, size=100,
    )
    db_session.commit()

    volumes = repo.list_by_study("s1", viewer_purpose_filter=["viewer_volume"])
    assert len(volumes) == 1
    assert volumes[0].display_name == "new.nii"


def test_file_repo_count_references(db_session):
    _setup_study_with_files(db_session)
    repo = FileRepo(db_session)

    repo.create_file_record(
        file_id="f1",
        study_id="s1", kind="nifti_raw",
        viewer_purpose=None, display_name="a.nii",
        blob_hash="a" * 64, size=100,
    )
    repo.create_file_record(
        file_id="f2",
        study_id="s1", kind="nifti_raw",
        viewer_purpose=None, display_name="b.nii",
        blob_hash="a" * 64, size=100,
    )

    assert repo.count_references("a" * 64) == 2


# -- PipelineJob --

def test_pipeline_job_crud(db_session):
    db_session.add(Study(id="s1"))
    db_session.add(FileRecord(
        id="f1", study_id="s1", kind="nifti_raw",
        display_name="x.nii", blob_hash="a" * 64, size=100,
    ))
    db_session.commit()

    repo = PipelineJobRepo(db_session)
    job = repo.create_for_study("s1")
    job.source_file_id = "f1"
    db_session.commit()
    assert job.status == "created"

    repo.set_status(job.id, "running")
    assert repo.get(job.id).status == "running"

    repo.set_status(job.id, "completed")
    assert repo.get(job.id).status == "completed"


def test_pipeline_job_get_active_for_study(db_session):
    db_session.add(Study(id="s1"))
    db_session.add(FileRecord(
        id="f1", study_id="s1", kind="nifti_raw",
        display_name="x.nii", blob_hash="a" * 64, size=100,
    ))
    db_session.commit()

    repo = PipelineJobRepo(db_session)
    job = repo.create_for_study("s1")
    job.source_file_id = "f1"
    db_session.commit()
    repo.prepare_dispatch("s1", ["segment_nifti"])
    job = repo.get_by_study_id("s1")
    repo.set_status(job.id, "running")

    active = repo.get_active_for_study("s1")
    assert active is not None
    assert active.id == job.id

    repo.set_status(job.id, "completed")
    assert repo.get_active_for_study("s1") is None
