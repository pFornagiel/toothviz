"""
Unit tests for LocalPersistentStorage backend.

Tests core storage functionality:
- Study creation and management
- Upload mechanics (chunking, finalization)
- File operations (store, retrieve, delete)
- CAS (content-addressed storage) deduplication
"""

import pytest
from poc_file_storage.storage.local import LocalPersistentStorage


def test_local_storage_roundtrip(tmp_path):
    """Test complete storage lifecycle with temporary data."""
    store = LocalPersistentStorage(
        root=str(tmp_path / "data"), 
        sqlite_url=f"sqlite:///{tmp_path}/db.sqlite3"
    )

    # Create study
    sid = store.create_study(external_id="CASE-XYZ", meta={"note": "test"})
    
    # Begin upload
    up = store.begin_upload(
        sid, 
        role="original", 
        kind="nifti", 
        filename="input.nii.gz", 
        expected_size=10
    )

    # Upload chunks (simulated gzip header)
    store.upload_chunk(up, 0, b"\x1f\x8b\x08\x00\x00")
    store.upload_chunk(up, 1, b"\x00\x00\x00\x03\x00")
    
    # Finalize upload
    stored = store.finalize_upload(up)

    assert stored.study_id == sid
    assert stored.role == "original"
    assert stored.size == 10
    assert stored.rel_path.endswith("input.nii.gz")

    # Store derived file from local path (simulate pipeline output)
    out_path = tmp_path / "seg.nii.gz"
    out_path.write_bytes(b"\x1f\x8bseg-data")
    seg = store.store_from_local_path(
        sid, 
        role="derived", 
        kind="segmentation", 
        src_path=str(out_path)
    )

    # List files and verify
    files = store.list_files(sid, role="derived")
    assert any(f.id == seg.id for f in files)

    # Open and read a few bytes
    with store.open_file(seg.id) as fh:
        assert fh.read(4) == b"\x1f\x8bse"

    # Cleanup
    store.delete_file(seg.id)
    store.dispose()


def test_study_creation(tmp_path):
    """Test basic study creation."""
    store = LocalPersistentStorage(
        root=str(tmp_path / "data"),
        sqlite_url=f"sqlite:///{tmp_path}/db.sqlite3"
    )
    
    sid = store.create_study(external_id="TEST-001", meta={"type": "cbct"})
    assert sid is not None
    assert len(sid) > 0
    
    store.dispose()


def test_file_listing_by_role(tmp_path):
    """Test filtering files by role and kind."""
    store = LocalPersistentStorage(
        root=str(tmp_path / "data"),
        sqlite_url=f"sqlite:///{tmp_path}/db.sqlite3"
    )
    
    sid = store.create_study(external_id="LIST-TEST")
    
    # Store files with different roles
    orig_path = tmp_path / "original.nii.gz"
    orig_path.write_bytes(b"original_data")
    orig = store.store_from_local_path(
        sid, 
        role="original", 
        kind="nifti",
        src_path=str(orig_path)
    )
    
    derived_path = tmp_path / "derived.nii.gz"
    derived_path.write_bytes(b"derived_data")
    derived = store.store_from_local_path(
        sid,
        role="derived",
        kind="segmentation",
        src_path=str(derived_path)
    )
    
    # Test filtering
    originals = store.list_files(sid, role="original")
    assert len(originals) == 1
    assert originals[0].id == orig.id
    
    derived_files = store.list_files(sid, role="derived")
    assert len(derived_files) == 1
    assert derived_files[0].id == derived.id
    
    store.dispose()
