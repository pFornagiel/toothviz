import pytest

from backend.db.repos.file_repo import FileRepo


def test_store_original_creates_file_record_and_links_cas(
    storage_service, storage_engine, db_session, session_factory, make_study,
):
    study = make_study(name="test")
    storage_engine.initialize_upload("u1")
    storage_engine.write_chunk("u1", 0, b"data123")

    record = storage_service.store_original(
        upload_id="u1", study_id=study.id, filename="test.nii",
        kind="nifti_raw", viewer_purpose="viewer_volume",
        expected_sha256=None, expected_size=None,
    )
    path = storage_engine.get_study_file_path(
        study.id, record.id, "test.nii",
    )
    assert path.is_file()
    assert record.viewer_purpose == "viewer_volume"

    with session_factory() as db:
        stored = FileRepo(db).get(record.id)
        assert stored.blob_hash == record.blob_hash
        cas_path = storage_engine.get_cas_blob_path(record.blob_hash)
        assert cas_path.is_file()


def test_store_original_viewer_purpose_supersede(
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
        volumes = repo.list_by_study(study.id, viewer_purpose_filter=["viewer_volume"])
        assert len(volumes) == 1
        assert volumes[0].id == r2.id


def test_store_derived_creates_file_record(
    storage_service, storage_engine, session_factory, make_study, tmp_path,
):
    study = make_study(name="test")

    src = tmp_path / "mask.nii"
    src.write_bytes(b"mask_data")

    record = storage_service.store_derived(
        src_path=src, study_id=study.id,
        filename="mask.nii", kind="segmentation_mask",
        viewer_purpose="viewer_overlay",
    )
    path = storage_engine.get_study_file_path(
        study.id, record.id, "mask.nii",
    )
    assert path.is_file()


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

    blob_path = storage_engine.get_cas_blob_path(r1.blob_hash)
    assert blob_path.is_file()


def test_sweep_orphans_delegates(storage_service, storage_engine):
    storage_engine.initialize_upload("u1")
    storage_engine.write_chunk("u1", 0, b"orphan")
    storage_engine.commit_upload_to_cas("u1", None, None)

    removed = storage_service.sweep_orphans()
    assert removed >= 1
