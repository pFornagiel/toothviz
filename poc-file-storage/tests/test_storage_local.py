from storage.local import LocalPersistentStorage

def test_local_storage_roundtrip(tmp_path):
    store = LocalPersistentStorage(root=str(tmp_path / "data"), sqlite_url=f"sqlite:///{tmp_path}/db.sqlite3")

    sid = store.create_study(external_id="CASE-XYZ", meta={"note": "test"})
    up = store.begin_upload(sid, role="original", kind="nifti", filename="input.nii.gz", expected_size=10)

    store.upload_chunk(up, 0, b"\x1f\x8b\x08\x00\x00")
    store.upload_chunk(up, 1, b"\x00\x00\x00\x03\x00")  #dummy gz header
    stored = store.finalize_upload(up)

    assert stored.study_id == sid
    assert stored.role == "original"
    assert stored.size == 10
    assert stored.rel_path.endswith("input.nii.gz")

    # derive a file from local path (simulate pipeline output)
    out_path = tmp_path / "seg.nii.gz"
    out_path.write_bytes(b"\x1f\x8bseg-data")
    seg = store.store_from_local_path(sid, role="derived", kind="segmentation", src_path=str(out_path))

    files = store.list_files(sid, role="derived")
    assert any(f.id == seg.id for f in files)

    # open and read a few bytes
    with store.open_file(seg.id) as fh:
        assert fh.read(4) == b"\x1f\x8bse"

    store.delete_file(seg.id)
    store.dispose()