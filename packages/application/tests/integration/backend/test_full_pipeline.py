"""Phase 4 gate: end-to-end pipeline tests with mocked subprocess fns."""

import io
import zipfile

import pytest

from backend.db.repos.file_repo import FileRepo


def _upload_file(client, study_id, kind="nifti_raw", filename="file.nii",
                 data=b"content", pipelines=None):
    if pipelines is None:
        pipelines = []

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
        json={"pipelines": pipelines},
    )
    assert resp.status_code == 200
    return resp.json()


def test_nifti_upload_with_precomputed_mask(client, created_study):
    study_id = created_study["id"]

    _upload_file(client, study_id, kind="nifti_raw", filename="vol.nii", data=b"volume")
    _upload_file(client, study_id, kind="nifti_mask", filename="mask.nii", data=b"mask")

    resp = client.get(
        f"/storage/studies/{study_id}/files?viewer_purpose=viewer_volume,viewer_overlay",
    )
    files = resp.json()
    purposes = {f["viewer_purpose"] for f in files}
    assert "viewer_volume" in purposes
    assert "viewer_overlay" in purposes


def test_cas_dedup(client, created_study, integration_app):
    study_id = created_study["id"]
    data = b"identical_content"

    r1 = _upload_file(client, study_id, kind="nifti_raw", filename="a.nii", data=data)
    r2 = _upload_file(client, study_id, kind="nifti_raw", filename="b.nii", data=data)

    svc = integration_app.state.storage_service
    with svc.session_factory() as db:
        f1 = FileRepo(db).get(r1["file_id"])
        f2 = FileRepo(db).get(r2["file_id"])
        assert f1.blob_hash == f2.blob_hash

        cas_path = svc.engine.get_cas_blob_path(f1.blob_hash)
        assert cas_path.is_file()


def test_purpose_supersede_on_re_upload(client, created_study, integration_app):
    study_id = created_study["id"]

    _upload_file(client, study_id, kind="nifti_mask", filename="old_mask.nii", data=b"old")
    _upload_file(client, study_id, kind="nifti_mask", filename="new_mask.nii", data=b"new")

    resp = client.get(
        f"/storage/studies/{study_id}/files?viewer_purpose=viewer_overlay",
    )
    overlays = resp.json()
    assert len(overlays) == 1
    assert overlays[0]["display_name"] == "new_mask.nii"


def test_study_delete_cascades(client, created_study, integration_app):
    study_id = created_study["id"]
    _upload_file(client, study_id, kind="nifti_raw", data=b"data")

    resp = client.delete(f"/storage/studies/{study_id}")
    assert resp.status_code == 204

    svc = integration_app.state.storage_service
    study_dir = svc.engine.root / "studies" / study_id
    assert not study_dir.exists()


def test_dicom_zip_finalize_with_segmentation_returns_job_id(client, created_study):
    study_id = created_study["id"]
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("slice.dcm", b"fake")
    data = buf.getvalue()

    result = _upload_file(
        client,
        study_id,
        kind="dicom_zip",
        filename="series.zip",
        data=data,
        pipelines=[{"name": "segment_nifti", "config": {}}],
    )
    assert result.get("job_id") is not None


@pytest.mark.asyncio
async def test_segmentation_failure_removes_study(integration_app, created_study):
    import asyncio
    from unittest.mock import AsyncMock

    from httpx import ASGITransport, AsyncClient

    study_id = created_study["id"]
    seg = integration_app.state.job_pipeline_service._worker_pools["segmentation"]
    seg.run = AsyncMock(side_effect=RuntimeError("segmentation failed"))

    transport = ASGITransport(app=integration_app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        resp = await ac.post(
            f"/storage/studies/{study_id}/uploads:begin",
            json={"kind": "nifti_raw", "filename": "vol.nii"},
        )
        assert resp.status_code == 201
        upload_id = resp.json()["upload_id"]

        resp = await ac.put(
            f"/storage/uploads/{upload_id}/chunk?index=0",
            content=b"volume-bytes",
        )
        assert resp.status_code == 200

        resp = await ac.post(
            f"/storage/uploads/{upload_id}:finalize",
            json={"pipelines": [{"name": "segment_nifti", "config": {}}]},
        )
        assert resp.status_code == 200

        gone = False
        for _ in range(200):
            r = await ac.get(f"/storage/studies/{study_id}")
            if r.status_code == 404:
                gone = True
                break
            await asyncio.sleep(0.05)

    assert gone, "study should be deleted after pipeline failure"

    transport2 = ASGITransport(app=integration_app)
    async with AsyncClient(transport=transport2, base_url="http://test") as ac2:
        listed = (await ac2.get("/storage/studies")).json()
    assert not any(s["id"] == study_id for s in listed)
