import pytest


def _upload_file(client, study_id, kind="nifti_raw", filename="file.nii", data=b"content"):
    resp = client.post(
        f"/storage/studies/{study_id}/uploads:begin",
        json={"kind": kind, "filename": filename},
    )
    assert resp.status_code == 201
    upload_id = resp.json()["upload_id"]

    resp = client.put(
        f"/storage/uploads/{upload_id}/chunk?index=0",
        content=data,
    )
    assert resp.status_code == 200

    resp = client.post(
        f"/storage/uploads/{upload_id}:finalize",
        json={"pipelines": []},
    )
    assert resp.status_code == 200
    return resp.json()


def test_create_list_rename_delete(client):
    resp = client.post("/storage/studies", json={"name": "Study1"})
    assert resp.status_code == 201
    study_id = resp.json()["id"]

    resp = client.get("/storage/studies")
    assert resp.status_code == 200
    assert any(s["id"] == study_id for s in resp.json())

    resp = client.patch(f"/storage/studies/{study_id}", json={"name": "Renamed"})
    assert resp.status_code == 200
    assert resp.json()["name"] == "Renamed"

    resp = client.delete(f"/storage/studies/{study_id}")
    assert resp.status_code == 204

    resp = client.get("/storage/studies")
    assert not any(s["id"] == study_id for s in resp.json())


def test_delete_study_cleans_up_files(client, created_study):
    study_id = created_study["id"]
    _upload_file(client, study_id)

    resp = client.delete(f"/storage/studies/{study_id}")
    assert resp.status_code == 204

    resp = client.get("/storage/studies")
    assert not any(s["id"] == study_id for s in resp.json())


def test_list_files_purpose_filter(client, created_study):
    study_id = created_study["id"]
    _upload_file(client, study_id, kind="nifti_raw", filename="vol.nii", data=b"volume")
    _upload_file(client, study_id, kind="nifti_mask", filename="mask.nii", data=b"mask")

    resp = client.get(
        f"/storage/studies/{study_id}/files?viewer_purpose=viewer_volume,viewer_overlay"
    )
    assert resp.status_code == 200
    files = resp.json()
    purposes = {f["viewer_purpose"] for f in files}
    assert "viewer_volume" in purposes
    assert "viewer_overlay" in purposes


def test_file_content_endpoint(client, created_study):
    study_id = created_study["id"]
    result = _upload_file(client, study_id, data=b"file_bytes_here")

    resp = client.get(
        f"/storage/studies/{study_id}/files/{result['file_id']}/content"
    )
    assert resp.status_code == 200
    assert resp.content == b"file_bytes_here"
