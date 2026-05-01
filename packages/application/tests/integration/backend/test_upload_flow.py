import pytest


def _do_upload(client, study_id, kind="nifti_raw", filename="scan.nii", chunks=None):
    """Helper to begin → chunk → finalize an upload."""
    if chunks is None:
        chunks = [b"chunk0", b"chunk1", b"chunk2"]

    resp = client.post(
        f"/storage/studies/{study_id}/uploads:begin",
        json={"kind": kind, "filename": filename},
    )
    assert resp.status_code == 201
    upload_id = resp.json()["upload_id"]

    for i, data in enumerate(chunks):
        resp = client.put(
            f"/storage/uploads/{upload_id}/chunk?index={i}",
            content=data,
        )
        assert resp.status_code == 200

    return upload_id, chunks


def test_begin_chunk_finalize_nifti(client, created_study):
    study_id = created_study["id"]
    upload_id, chunks = _do_upload(client, study_id)

    resp = client.post(
        f"/storage/uploads/{upload_id}:finalize",
        json={"pipelines": []},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "file_id" in data
    assert data["job_id"] is None


def test_upload_status_returns_chunks(client, created_study):
    study_id = created_study["id"]
    upload_id, _ = _do_upload(client, study_id, chunks=[b"a", b"b"])

    resp = client.get(f"/storage/uploads/{upload_id}/status")
    assert resp.status_code == 200
    assert set(resp.json()["uploaded_chunks"]) == {0, 1}


def test_abort_upload(client, created_study):
    study_id = created_study["id"]
    upload_id, _ = _do_upload(client, study_id, chunks=[b"data"])

    resp = client.delete(f"/storage/uploads/{upload_id}")
    assert resp.status_code == 204

    resp = client.get(f"/storage/uploads/{upload_id}/status")
    assert resp.json()["state"] == "aborted"


def test_finalize_with_expected_size(client, created_study):
    study_id = created_study["id"]
    payload = b"verified_content"
    upload_id, _ = _do_upload(client, study_id, chunks=[payload])

    resp = client.post(
        f"/storage/uploads/{upload_id}:finalize",
        json={"expected_size": len(payload), "pipelines": []},
    )
    assert resp.status_code == 200


def test_finalize_size_mismatch_returns_error(client, created_study):
    study_id = created_study["id"]
    upload_id, _ = _do_upload(client, study_id, chunks=[b"data"])

    resp = client.post(
        f"/storage/uploads/{upload_id}:finalize",
        json={"expected_size": 999, "pipelines": []},
    )
    assert resp.status_code == 422


def test_invalid_kind_returns_422(client, created_study):
    study_id = created_study["id"]
    resp = client.post(
        f"/storage/studies/{study_id}/uploads:begin",
        json={"kind": "invalid", "filename": "test.nii"},
    )
    assert resp.status_code == 422
