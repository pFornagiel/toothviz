import pytest
from sqlalchemy.exc import IntegrityError

from backend.db.models import (
    Base, Study, Blob, FileRecord, UploadSession, PipelineJob,
)


def test_create_all_tables(db_engine):
    table_names = set(Base.metadata.tables.keys())
    expected = {"studies", "blobs", "file_records", "upload_sessions", "pipeline_jobs"}
    assert expected == table_names


def test_study_columns(db_session):
    study = Study(id="s1", name="Test Study", status="created", meta={"k": "v"})
    db_session.add(study)
    db_session.commit()

    loaded = db_session.get(Study, "s1")
    assert loaded.name == "Test Study"
    assert loaded.updated_at is not None
    assert loaded.meta == {"k": "v"}


def test_file_record_purpose(db_session):
    db_session.add(Study(id="s1", status="created"))
    db_session.add(Blob(hash="a" * 64, size=100))
    db_session.commit()

    rec = FileRecord(
        id="f1", study_id="s1", role="original", kind="nifti_raw",
        purpose="viewer_volume", rel_path="studies/s1/raw/test.nii",
        blob_hash="a" * 64, size=100,
    )
    db_session.add(rec)
    db_session.commit()

    loaded = db_session.get(FileRecord, "f1")
    assert loaded.purpose == "viewer_volume"


def test_pipeline_job_steps_json(db_session):
    db_session.add(Study(id="s1", status="created"))
    db_session.add(Blob(hash="a" * 64, size=100))
    db_session.add(FileRecord(
        id="f1", study_id="s1", role="original", kind="nifti_raw",
        rel_path="x", blob_hash="a" * 64, size=100,
    ))
    db_session.commit()

    job = PipelineJob(
        id="j1", study_id="s1", source_file_id="f1",
        steps=["dicom_to_nifti", "segment_nifti"],
    )
    db_session.add(job)
    db_session.commit()

    loaded = db_session.get(PipelineJob, "j1")
    assert loaded.steps == ["dicom_to_nifti", "segment_nifti"]


def test_foreign_keys(db_session):
    rec = FileRecord(
        id="f1", study_id="nonexistent", role="original", kind="nifti_raw",
        rel_path="x", blob_hash="a" * 64, size=100,
    )
    db_session.add(rec)
    with pytest.raises(IntegrityError):
        db_session.commit()
