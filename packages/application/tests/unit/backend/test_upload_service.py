import pytest

from backend.db.models import Blob
from backend.db.repos.file_repo import FileRepo
from backend.services.upload_service import UploadService


@pytest.fixture()
def upload_service(storage_service):
    return UploadService(storage_service, job_pipeline_service=None)


def test_begin_session_creates_upload_and_parts_dir(
    upload_service, storage_engine, make_study, session_factory,
):
    study = make_study(name="test")
    result = upload_service.begin_session(
        study.id, kind="nifti_raw", filename="scan.nii",
    )
    assert "upload_id" in result
    assert "chunk_size" in result

    parts_dir = storage_engine.root / "uploads" / result["upload_id"] / "parts"
    assert parts_dir.exists()


def test_write_chunk_stores_data(
    upload_service, storage_engine, make_study,
):
    study = make_study(name="test")
    result = upload_service.begin_session(
        study.id, kind="nifti_raw", filename="scan.nii",
    )
    uid = result["upload_id"]

    upload_service.write_chunk(uid, 0, b"chunk_data")
    part = storage_engine.root / "uploads" / uid / "parts" / "part_00000000.chunk"
    assert part.read_bytes() == b"chunk_data"


def test_write_chunk_idempotent(
    upload_service, make_study,
):
    study = make_study(name="test")
    result = upload_service.begin_session(
        study.id, kind="nifti_raw", filename="scan.nii",
    )
    uid = result["upload_id"]

    r1 = upload_service.write_chunk(uid, 0, b"chunk_data")
    r2 = upload_service.write_chunk(uid, 0, b"chunk_data")
    assert r1["received"] == r2["received"]


def test_get_status(upload_service, make_study):
    study = make_study(name="test")
    result = upload_service.begin_session(
        study.id, kind="nifti_raw", filename="scan.nii",
    )
    uid = result["upload_id"]

    upload_service.write_chunk(uid, 0, b"a")
    upload_service.write_chunk(uid, 1, b"b")

    status = upload_service.get_status(uid)
    assert status["state"] == "active"
    assert set(status["uploaded_chunks"]) == {0, 1}


def test_abort_session(upload_service, storage_engine, make_study):
    study = make_study(name="test")
    result = upload_service.begin_session(
        study.id, kind="nifti_raw", filename="scan.nii",
    )
    uid = result["upload_id"]

    upload_service.write_chunk(uid, 0, b"data")
    upload_service.abort_session(uid)

    status = upload_service.get_status(uid)
    assert status["state"] == "aborted"


def test_finalize_nifti_raw_sets_viewer_volume(
    upload_service, make_study, session_factory,
):
    study = make_study(name="test")
    result = upload_service.begin_session(
        study.id, kind="nifti_raw", filename="scan.nii",
    )
    uid = result["upload_id"]

    upload_service.write_chunk(uid, 0, b"nifti_content")
    fin = upload_service.finalize(uid, pipelines=[])

    assert fin["job_id"] is None

    with session_factory() as db:
        rec = FileRepo(db).get(fin["file_id"])
        assert rec.viewer_purpose == "viewer_volume"


def test_finalize_nifti_mask_sets_viewer_overlay(
    upload_service, make_study, session_factory,
):
    study = make_study(name="test")
    result = upload_service.begin_session(
        study.id, kind="nifti_mask", filename="mask.nii",
    )
    uid = result["upload_id"]

    upload_service.write_chunk(uid, 0, b"mask_content")
    fin = upload_service.finalize(uid, pipelines=[])

    with session_factory() as db:
        rec = FileRepo(db).get(fin["file_id"])
        assert rec.viewer_purpose == "viewer_overlay"


def test_finalize_dicom_zip_sets_null_purpose(
    upload_service, make_study, session_factory,
):
    study = make_study(name="test")
    result = upload_service.begin_session(
        study.id, kind="dicom_zip", filename="scan.zip",
    )
    uid = result["upload_id"]

    upload_service.write_chunk(uid, 0, b"zip_content")
    fin = upload_service.finalize(uid, pipelines=[])

    with session_factory() as db:
        rec = FileRepo(db).get(fin["file_id"])
        assert rec.viewer_purpose is None
