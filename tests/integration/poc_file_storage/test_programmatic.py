"""
Integration tests for LocalPersistentStorage end-to-end workflow.

Tests full pipeline:
- Real NIfTI file generation with nibabel
- Study creation and management
- Original file upload with proper roles/kinds
- Derived file generation (e.g., segmentation masks)
- File listing, retrieval, and metadata preservation
- Cleanup and disposal
"""

import numpy as np
import nibabel as nib
from pathlib import Path

from poc_file_storage.storage.local import LocalPersistentStorage


def test_programmatic_nifti_workflow(tmp_path):
    """
    Complete end-to-end workflow:
    1. Generate synthetic NIfTI
    2. Store as original
    3. Generate segmentation mask
    4. Store as derived
    5. Verify retrieval and metadata
    """
    # Setup storage
    store = LocalPersistentStorage(
        root=str(tmp_path / "data"), 
        sqlite_url=f"sqlite:///{tmp_path}/db.sqlite3"
    )

    # Create study
    sid = store.create_study(
        external_id="CASE-TOOTH", 
        meta={"note": "programmatic test"}
    )
    print(f"Study created: {sid}")

    # Generate synthetic NIfTI
    input_path = tmp_path / "test_cbct.nii.gz"
    arr = (np.random.rand(64, 64, 64) * 1000).astype(np.float32)
    img = nib.Nifti1Image(arr, affine=np.eye(4))
    nib.save(img, input_path)
    print(f"Synthetic NIfTI created: {input_path}")

    # Store original NIfTI
    orig = store.store_from_local_path(
        study_id=sid, 
        role="original", 
        kind="nifti",
        src_path=str(input_path), 
        filename="input.nii.gz", 
        content_type="application/gzip"
    )
    print(f"Original stored: {orig.id}")
    assert orig.kind == "nifti"
    assert orig.role == "original"
    assert orig.size > 0

    # Generate segmentation mask from original
    img = nib.load(str(input_path))
    arr = img.get_fdata()
    mask = (arr > np.percentile(arr, 75)).astype(np.uint8)
    mask_img = nib.Nifti1Image(mask, affine=img.affine)
    mask_path = tmp_path / "seg_model_v1.nii.gz"
    nib.save(mask_img, str(mask_path))
    print(f"Segmentation mask created: {mask_path}")

    # Store mask as derived
    seg = store.store_from_local_path(
        study_id=sid, 
        role="derived", 
        kind="segmentation",
        src_path=str(mask_path), 
        filename="seg_model-v1.nii.gz",
        content_type="application/gzip", 
        meta={"model": "demo_threshold", "threshold": 0.75}
    )
    print(f"Segmentation stored: {seg.id}")
    assert seg.kind == "segmentation"
    assert seg.role == "derived"
    assert seg.meta.get("model") == "demo_threshold"

    # List files by role
    derived_files = store.list_files(sid, role="derived", kind="segmentation")
    print(f"Derived files: {[f.id for f in derived_files]}")
    assert len(derived_files) >= 1
    assert any(f.id == seg.id for f in derived_files)

    # Verify file retrieval
    with store.open_file(seg.id) as f:
        first_bytes = f.read(16)
        print(f"First 16 bytes of seg file: {first_bytes}")
        assert first_bytes[:2] == b"\x1f\x8b"  # gzip magic

    store.dispose()
    print("Test complete")


def test_cas_deduplication_workflow(tmp_path):
    """
    Test that identical files are deduplicated at CAS level
    (same SHA256 hash = same blob).
    """
    store = LocalPersistentStorage(
        root=str(tmp_path / "data"),
        sqlite_url=f"sqlite:///{tmp_path}/db.sqlite3"
    )

    # Create study
    sid = store.create_study(external_id="CAS-TEST", meta={"test": "dedup"})

    # Create two identical files
    file1_path = tmp_path / "file1.nii.gz"
    file2_path = tmp_path / "file2.nii.gz"
    identical_data = b"identical_content_for_cas_test"
    file1_path.write_bytes(identical_data)
    file2_path.write_bytes(identical_data)

    # Store both
    rec1 = store.store_from_local_path(
        sid, role="original", kind="nifti",
        src_path=str(file1_path), filename="file1.nii.gz"
    )
    rec2 = store.store_from_local_path(
        sid, role="original", kind="nifti",
        src_path=str(file2_path), filename="file2.nii.gz"
    )

    # Both should have the same blob_hash (CAS property)
    assert rec1.blob_hash == rec2.blob_hash
    print(f"CAS deduplication verified: {rec1.blob_hash}")

    store.dispose()


def test_upload_session_chunking(tmp_path):
    """
    Test resumable upload with chunk tracking.
    """
    store = LocalPersistentStorage(
        root=str(tmp_path / "data"),
        sqlite_url=f"sqlite:///{tmp_path}/db.sqlite3"
    )

    sid = store.create_study(external_id="CHUNK-TEST")

    # Begin upload session
    upload_id = store.begin_upload(
        sid,
        role="original",
        kind="nifti",
        filename="chunked.nii.gz",
        expected_size=300,
        expected_sha256=None  # We'll skip validation for this test
    )

    # Upload in 3 chunks
    chunk1 = b"chunk1_data_" * 10
    chunk2 = b"chunk2_data_" * 10
    chunk3 = b"chunk3_data_" * 5

    store.upload_chunk(upload_id, 0, chunk1)
    store.upload_chunk(upload_id, 1, chunk2)
    store.upload_chunk(upload_id, 2, chunk3)

    # Finalize
    result = store.finalize_upload(upload_id)

    assert result.size == len(chunk1) + len(chunk2) + len(chunk3)
    assert result.role == "original"
    print(f"Chunked upload completed: {result.size} bytes")

    store.dispose()
