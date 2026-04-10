import hashlib
import os

import pytest

from backend.storage.local_engine import LocalStorageEngine
from backend.exceptions import ValidationError


@pytest.fixture()
def engine(tmp_data_root):
    return LocalStorageEngine(tmp_data_root)


def test_initialize_and_write_chunks(engine):
    engine.initialize_upload("u1")
    engine.write_chunk("u1", 0, b"chunk0")
    engine.write_chunk("u1", 1, b"chunk1")
    engine.write_chunk("u1", 2, b"chunk2")

    parts_dir = engine.root / "uploads" / "u1" / "parts"
    assert len(list(parts_dir.glob("part_*.chunk"))) == 3


def test_commit_upload_to_cas(engine):
    engine.initialize_upload("u1")
    engine.write_chunk("u1", 0, b"hello")
    engine.write_chunk("u1", 1, b"world")

    blob_hash, size = engine.commit_upload_to_cas("u1", None, None)
    assert size == 10
    expected_hash = hashlib.sha256(b"helloworld").hexdigest()
    assert blob_hash == expected_hash

    blob_path = engine.get_cas_blob_path(blob_hash)
    assert blob_path.exists()
    assert blob_path.read_bytes() == b"helloworld"


def test_commit_upload_size_mismatch(engine):
    engine.initialize_upload("u1")
    engine.write_chunk("u1", 0, b"data")

    with pytest.raises(ValidationError, match="size mismatch"):
        engine.commit_upload_to_cas("u1", None, 999)


def test_commit_upload_sha_mismatch(engine):
    engine.initialize_upload("u1")
    engine.write_chunk("u1", 0, b"data")

    with pytest.raises(ValidationError, match="checksum mismatch"):
        engine.commit_upload_to_cas("u1", "wrong_hash", None)


def test_commit_file_to_cas(engine, tmp_path):
    src = tmp_path / "file.bin"
    src.write_bytes(b"content")

    blob_hash, size = engine.commit_file_to_cas(src)
    assert size == 7
    expected = hashlib.sha256(b"content").hexdigest()
    assert blob_hash == expected
    assert engine.get_cas_blob_path(blob_hash).exists()


def test_commit_deduplication(engine):
    engine.initialize_upload("u1")
    engine.write_chunk("u1", 0, b"same")
    h1, _ = engine.commit_upload_to_cas("u1", None, None)

    engine.initialize_upload("u2")
    engine.write_chunk("u2", 0, b"same")
    h2, _ = engine.commit_upload_to_cas("u2", None, None)

    assert h1 == h2
    blobs_dir = engine.root / "blobs" / "sha256"
    blob_files = list(blobs_dir.rglob("*"))
    blob_files = [f for f in blob_files if f.is_file()]
    assert len(blob_files) == 1


def test_link_file_to_study(engine):
    engine.initialize_upload("u1")
    engine.write_chunk("u1", 0, b"data")
    blob_hash, _ = engine.commit_upload_to_cas("u1", None, None)

    study_dir = engine.root / "studies" / "s1" / "raw"
    study_dir.mkdir(parents=True, exist_ok=True)

    link = engine.link_file_to_study("s1", "original", "test.nii", blob_hash)
    assert link.exists()

    blob_path = engine.get_cas_blob_path(blob_hash)
    assert os.stat(str(link)).st_ino == os.stat(str(blob_path)).st_ino


def test_get_cas_blob_path(engine):
    h = "abcdef" + "0" * 58
    path = engine.get_cas_blob_path(h)
    assert str(path).endswith(f"blobs/sha256/ab/{h}")


def test_get_job_workspace_dir(engine):
    path = engine.get_job_workspace_dir("job123")
    assert str(path).endswith("tmp/jobs/job123")


def test_abort_upload(engine):
    engine.initialize_upload("u1")
    engine.write_chunk("u1", 0, b"data")
    engine.abort_upload("u1")

    assert not (engine.root / "uploads" / "u1").exists()


def test_remove_study_data(engine):
    study_dir = engine.root / "studies" / "s1"
    (study_dir / "raw").mkdir(parents=True)
    (study_dir / "raw" / "file.nii").write_bytes(b"x")

    engine.remove_study_data("s1")
    assert not study_dir.exists()


def test_sweep_orphaned_blobs(engine):
    engine.initialize_upload("u1")
    engine.write_chunk("u1", 0, b"orphan")
    blob_hash, _ = engine.commit_upload_to_cas("u1", None, None)

    blob_path = engine.get_cas_blob_path(blob_hash)
    assert blob_path.stat().st_nlink == 1

    removed = engine.sweep_orphaned_blobs()
    assert removed == 1
    assert not blob_path.exists()


def test_sweep_retains_linked_blobs(engine):
    engine.initialize_upload("u1")
    engine.write_chunk("u1", 0, b"linked")
    blob_hash, _ = engine.commit_upload_to_cas("u1", None, None)

    study_dir = engine.root / "studies" / "s1" / "raw"
    study_dir.mkdir(parents=True, exist_ok=True)
    engine.link_file_to_study("s1", "original", "f.nii", blob_hash)

    removed = engine.sweep_orphaned_blobs()
    assert removed == 0
    assert engine.get_cas_blob_path(blob_hash).exists()


def test_list_uploaded_chunks(engine):
    engine.initialize_upload("u1")
    engine.write_chunk("u1", 0, b"a")
    engine.write_chunk("u1", 2, b"c")
    engine.write_chunk("u1", 1, b"b")

    chunks = engine.list_uploaded_chunks("u1")
    assert chunks == [0, 1, 2]
