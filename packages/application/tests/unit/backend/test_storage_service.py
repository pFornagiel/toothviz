import pytest

from backend.db.repos.file_repo import FileRepo
from backend.db.models import Study, Blob


def test_store_original_creates_blob_and_file_record(
    storage_service, storage_engine, db_session, session_factory, make_study,
):
    study = make_study(name="test")
    storage_engine.initialize_upload("u1")
    storage_engine.write_chunk("u1", 0, b"data123")

    record = storage_service.store_original(
        upload_id="u1", study_id=study.id, filename="test.nii",
        kind="nifti_raw", purpose="viewer_volume",
        expected_sha256=None, expected_size=None,
    )
    assert "/raw/" in record.rel_path.replace("\\", "/")
    assert record.purpose == "viewer_volume"

    with session_factory() as db:
        blob = db.get(Blob, record.blob_hash)
        assert blob is not None


def test_store_original_purpose_supersede(
    storage_service, storage_engine, session_factory, make_study,
):
    study = make_study(name="test")

    storage_engine.initialize_upload("u1")
    storage_engine.write_chunk("u1", 0, b"first")
    r1 = storage_service.store_original(
        "u1", study.id, "a.nii", "nifti_raw", "viewer_volume", None, None,
    )

    storage_engine.initialize_upload("u2")
    storage_engine.write_chunk("u2", 0, b"second")
    r2 = storage_service.store_original(
        "u2", study.id, "b.nii", "nifti_raw", "viewer_volume", None, None,
    )

    with session_factory() as db:
        repo = FileRepo(db)
        volumes = repo.list_by_study(study.id, purpose_filter=["viewer_volume"])
        assert len(volumes) == 1
        assert volumes[0].id == r2.id


def test_store_derived_creates_blob_and_file_record(
    storage_service, storage_engine, session_factory, make_study, db_session, tmp_path,
):
    from backend.db.models import Blob, FileRecord, PipelineJob
    study = make_study(name="test")

    db_session.add(Blob(hash="b" * 64, size=50))
    db_session.add(FileRecord(
        id="f1", study_id=study.id, kind="nifti_raw",
        rel_path="x", blob_hash="b" * 64, size=50,
    ))
    job = PipelineJob(id="j1", study_id=study.id, source_file_id="f1", steps=["seg"])
    db_session.add(job)
    db_session.commit()

    src = tmp_path / "mask.nii"
    src.write_bytes(b"mask_data")

    record = storage_service.store_derived(
        src_path=src, study_id=study.id, job_id="j1",
        filename="mask.nii", kind="segmentation_mask",
        purpose="viewer_overlay",
    )
    assert "/derived/" in record.rel_path.replace("\\", "/")
    assert record.pipeline_job_id == "j1"


def test_store_original_cas_dedup(
    storage_service, storage_engine, session_factory, make_study,
):
    study = make_study(name="test")

    storage_engine.initialize_upload("u1")
    storage_engine.write_chunk("u1", 0, b"same_data")
    r1 = storage_service.store_original(
        "u1", study.id, "a.nii", "nifti_raw", None, None, None,
    )

    storage_engine.initialize_upload("u2")
    storage_engine.write_chunk("u2", 0, b"same_data")
    r2 = storage_service.store_original(
        "u2", study.id, "b.nii", "nifti_raw", None, None, None,
    )

    assert r1.blob_hash == r2.blob_hash

    with session_factory() as db:
        count = db.query(Blob).count()
        assert count == 1


def test_sweep_orphans_delegates(storage_service, storage_engine):
    storage_engine.initialize_upload("u1")
    storage_engine.write_chunk("u1", 0, b"orphan")
    storage_engine.commit_upload_to_cas("u1", None, None)

    removed = storage_service.sweep_orphans()
    assert removed >= 1
