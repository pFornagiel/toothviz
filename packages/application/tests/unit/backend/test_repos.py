import pytest

from backend.db.models import Study, Blob, FileRecord
from backend.db.repos.study_repo import StudyRepo
from backend.db.repos.upload_session_repo import UploadSessionRepo
from backend.db.repos.file_repo import FileRepo
from backend.db.repos.pipeline_job_repo import PipelineJobRepo
from backend.exceptions import NotFoundError


# -- Study --

def test_study_crud(db_session):
    repo = StudyRepo(db_session)
    study = repo.create(name="S1", external_id="ext1", meta={"k": 1})
    assert study.name == "S1"

    fetched = repo.get(study.id)
    assert fetched.external_id == "ext1"

    listed = repo.list()
    assert len(listed) == 1

    renamed = repo.rename(study.id, "S2")
    assert renamed.name == "S2"

    repo.delete(study.id)
    with pytest.raises(NotFoundError):
        repo.get(study.id)


def test_study_list_filter_external_id(db_session):
    repo = StudyRepo(db_session)
    repo.create(name="A", external_id="e1")
    repo.create(name="B", external_id="e2")

    results = repo.list(external_id="e1")
    assert len(results) == 1
    assert results[0].name == "A"


# -- UploadSession --

def test_upload_session_crud(db_session):
    db_session.add(Study(id="s1", status="created"))
    db_session.commit()

    repo = UploadSessionRepo(db_session)
    session = repo.create("s1", "file.nii", "nifti_raw", chunk_size=1024)
    assert session.state == "active"

    fetched = repo.get(session.id)
    assert fetched.filename == "file.nii"

    repo.update_state(session.id, "finalized")
    assert repo.get(session.id).state == "finalized"


def test_upload_session_list_by_state(db_session):
    db_session.add(Study(id="s1", status="created"))
    db_session.commit()

    repo = UploadSessionRepo(db_session)
    repo.create("s1", "a.nii", "nifti_raw", chunk_size=1024)
    s2 = repo.create("s1", "b.nii", "nifti_raw", chunk_size=1024)
    repo.update_state(s2.id, "aborted")

    active = repo.list_by_state("active")
    assert len(active) == 1

    aborted = repo.list_by_state("aborted")
    assert len(aborted) == 1


# -- FileRepo --

def _setup_study_and_blob(db_session):
    db_session.add(Study(id="s1", status="created"))
    db_session.add(Blob(hash="a" * 64, size=100))
    db_session.commit()


def test_file_repo_create_blob_upsert(db_session):
    repo = FileRepo(db_session)
    b1 = repo.create_blob("a" * 64, 100)
    b2 = repo.create_blob("a" * 64, 100)
    assert b1.hash == b2.hash

    count = db_session.query(Blob).count()
    assert count == 1


def test_file_repo_create_and_list(db_session):
    _setup_study_and_blob(db_session)
    repo = FileRepo(db_session)

    repo.create_file_record(
        study_id="s1", kind="nifti_raw",
        purpose="viewer_volume", original_filename="v.nii",
        rel_path="studies/s1/raw/v.nii", blob_hash="a" * 64, size=100,
    )
    repo.create_file_record(
        study_id="s1", kind="segmentation_mask",
        purpose="viewer_overlay", original_filename="m.nii",
        rel_path="studies/s1/derived/m.nii", blob_hash="a" * 64, size=100,
    )

    all_files = repo.list_by_study("s1")
    assert len(all_files) == 2

    volumes = repo.list_by_study("s1", purpose_filter=["viewer_volume"])
    assert len(volumes) == 1


def test_file_repo_null_purpose(db_session):
    _setup_study_and_blob(db_session)
    repo = FileRepo(db_session)

    repo.create_file_record(
        study_id="s1", kind="nifti_raw",
        purpose="viewer_volume", original_filename="old.nii",
        rel_path="studies/s1/raw/old.nii", blob_hash="a" * 64, size=100,
    )
    repo.null_purpose("s1", "viewer_volume")

    repo.create_file_record(
        study_id="s1", kind="nifti_raw",
        purpose="viewer_volume", original_filename="new.nii",
        rel_path="studies/s1/raw/new.nii", blob_hash="a" * 64, size=100,
    )
    db_session.commit()

    volumes = repo.list_by_study("s1", purpose_filter=["viewer_volume"])
    assert len(volumes) == 1
    assert volumes[0].original_filename == "new.nii"


def test_file_repo_count_references(db_session):
    _setup_study_and_blob(db_session)
    repo = FileRepo(db_session)

    repo.create_file_record(
        study_id="s1", kind="nifti_raw",
        purpose=None, original_filename="a.nii",
        rel_path="studies/s1/raw/a.nii", blob_hash="a" * 64, size=100,
    )
    repo.create_file_record(
        study_id="s1", kind="nifti_raw",
        purpose=None, original_filename="b.nii",
        rel_path="studies/s1/raw/b.nii", blob_hash="a" * 64, size=100,
    )

    assert repo.count_references("a" * 64) == 2


# -- PipelineJob --

def test_pipeline_job_crud(db_session):
    db_session.add(Study(id="s1", status="created"))
    db_session.add(Blob(hash="a" * 64, size=100))
    db_session.add(FileRecord(
        id="f1", study_id="s1", kind="nifti_raw",
        rel_path="x", blob_hash="a" * 64, size=100,
    ))
    db_session.commit()

    repo = PipelineJobRepo(db_session)
    job = repo.create("s1", "f1", ["dicom_to_nifti"])
    assert job.status == "queued"

    repo.set_status(job.id, "running")
    assert repo.get(job.id).status == "running"
    assert repo.get(job.id).started_at is not None

    repo.set_status(job.id, "completed")
    assert repo.get(job.id).finished_at is not None


def test_pipeline_job_get_active_for_study(db_session):
    db_session.add(Study(id="s1", status="created"))
    db_session.add(Blob(hash="a" * 64, size=100))
    db_session.add(FileRecord(
        id="f1", study_id="s1", kind="nifti_raw",
        rel_path="x", blob_hash="a" * 64, size=100,
    ))
    db_session.commit()

    repo = PipelineJobRepo(db_session)
    job = repo.create("s1", "f1", ["segment_nifti"])
    repo.set_status(job.id, "running")

    active = repo.get_active_for_study("s1")
    assert active is not None
    assert active.id == job.id

    repo.set_status(job.id, "completed")
    assert repo.get_active_for_study("s1") is None
