from __future__ import annotations

import hashlib
import os
import shutil
from pathlib import Path

from backend.exceptions import ValidationError
from backend.config import CAS_BLOB_HASH_LENGTH, DEFAULT_CHUNK_SIZE


class LocalStorageEngine:
    """StorageEngine implementation backed by the local filesystem."""

    def __init__(self, data_root: Path) -> None:
        self.root = Path(data_root).resolve()
        (self.root / "blobs" / "sha256").mkdir(parents=True, exist_ok=True)
        (self.root / "studies").mkdir(parents=True, exist_ok=True)
        (self.root / "uploads").mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------------
    # Path helpers
    # ------------------------------------------------------------------

    def _upload_parts_dir(self, upload_id: str) -> Path:
        return self.root / "uploads" / upload_id / "parts"

    def get_cas_blob_path(self, blob_hash: str) -> Path:
        return self.root / "blobs" / "sha256" / blob_hash[:CAS_BLOB_HASH_LENGTH] / blob_hash

    def get_job_workspace_dir(self, job_id: str) -> Path:
        return self.root / "tmp" / "jobs" / job_id

    def get_study_file_path(
        self, study_id: str, file_id: str, display_name: str
    ) -> Path:
        """Absolute path: studies/{study_id}/files/{file_id}/{display_name}."""
        safe_name = os.path.basename(display_name)
        return self.root / "studies" / study_id / "files" / file_id / safe_name

    # ------------------------------------------------------------------
    # Upload lifecycle
    # ------------------------------------------------------------------

    def initialize_upload(self, upload_id: str) -> None:
        self._upload_parts_dir(upload_id).mkdir(parents=True, exist_ok=True)

    def write_chunk(self, upload_id: str, index: int, data: bytes) -> None:
        part = self._upload_parts_dir(upload_id) / f"part_{index:08d}.chunk"
        part.parent.mkdir(parents=True, exist_ok=True)
        part.write_bytes(data)

    def get_chunk_size(self, upload_id: str, index: int) -> int | None:
        part = self._upload_parts_dir(upload_id) / f"part_{index:08d}.chunk"
        if part.exists():
            return part.stat().st_size
        return None

    def list_uploaded_chunks(self, upload_id: str) -> list[int]:
        parts_dir = self._upload_parts_dir(upload_id)
        if not parts_dir.exists():
            return []
        indices: list[int] = []
        for p in sorted(parts_dir.glob("part_*.chunk")):
            try:
                indices.append(int(p.stem.split("_")[1]))
            except (IndexError, ValueError):
                continue
        return indices

    def abort_upload(self, upload_id: str) -> None:
        upload_dir = self.root / "uploads" / upload_id
        if upload_dir.exists():
            shutil.rmtree(upload_dir, ignore_errors=True)

    # ------------------------------------------------------------------
    # CAS operations
    # ------------------------------------------------------------------

    @staticmethod
    def _sha256_file(path: Path) -> tuple[str, int]:
        h = hashlib.sha256()
        size = 0
        with open(path, "rb") as f:
            while True:
                chunk = f.read(DEFAULT_CHUNK_SIZE)
                if not chunk:
                    break
                size += len(chunk)
                h.update(chunk)
        return h.hexdigest(), size

    def commit_upload_to_cas(
        self,
        upload_id: str,
        expected_sha256: str | None,
        expected_size: int | None,
    ) -> tuple[str, int]:
        parts_dir = self._upload_parts_dir(upload_id)
        parts = sorted(parts_dir.glob("part_*.chunk"))
        if not parts:
            raise ValidationError("no parts uploaded")

        tmp_concat = parts_dir.parent / "concat.tmp"
        h = hashlib.sha256()
        total = 0
        with open(tmp_concat, "wb") as out:
            for p in parts:
                with open(p, "rb") as fp:
                    while True:
                        block = fp.read(DEFAULT_CHUNK_SIZE)
                        if not block:
                            break
                        total += len(block)
                        h.update(block)
                        out.write(block)

        blob_hash = h.hexdigest()

        if expected_size is not None and expected_size != total:
            tmp_concat.unlink(missing_ok=True)
            raise ValidationError(
                f"size mismatch: expected={expected_size}, got={total}"
            )
        if expected_sha256 is not None and expected_sha256 != blob_hash:
            tmp_concat.unlink(missing_ok=True)
            raise ValidationError(
                f"checksum mismatch: expected={expected_sha256}, got={blob_hash}"
            )

        blob_path = self.get_cas_blob_path(blob_hash)
        blob_path.parent.mkdir(parents=True, exist_ok=True)
        if not blob_path.exists():
            os.replace(str(tmp_concat), str(blob_path))
        else:
            tmp_concat.unlink(missing_ok=True)

        return blob_hash, total

    def commit_file_to_cas(self, src_path: Path) -> tuple[str, int]:
        src = Path(src_path)
        blob_hash, size = self._sha256_file(src)

        blob_path = self.get_cas_blob_path(blob_hash)
        blob_path.parent.mkdir(parents=True, exist_ok=True)
        if not blob_path.exists():
            tmp = blob_path.with_suffix(".tmp")
            shutil.copy2(str(src), str(tmp))
            os.replace(str(tmp), str(blob_path))

        return blob_hash, size

    # ------------------------------------------------------------------
    # Study filesystem
    # ------------------------------------------------------------------

    def link_study_file(
        self,
        study_id: str,
        file_id: str,
        display_name: str,
        blob_hash: str,
    ) -> Path:
        link_path = self.get_study_file_path(study_id, file_id, display_name)
        link_path.parent.mkdir(parents=True, exist_ok=True)
        if link_path.exists():
            link_path.unlink()
        blob_path = self.get_cas_blob_path(blob_hash)
        try:
            os.link(str(blob_path), str(link_path))
        except OSError:
            shutil.copy2(str(blob_path), str(link_path))

        return link_path

    def remove_study_data(self, study_id: str) -> None:
        study_dir = self.root / "studies" / study_id
        if study_dir.exists():
            shutil.rmtree(study_dir, ignore_errors=True)

    # ------------------------------------------------------------------
    # GC
    # ------------------------------------------------------------------

    def delete_blob(self, blob_hash: str) -> None:
        blob_path = self.get_cas_blob_path(blob_hash)
        if blob_path.exists():
            blob_path.unlink(missing_ok=True)

    def sweep_orphaned_blobs(self) -> int:
        blobs_root = self.root / "blobs" / "sha256"
        if not blobs_root.exists():
            return 0

        removed = 0
        for prefix_dir in blobs_root.iterdir():
            if not prefix_dir.is_dir():
                continue
            for blob_file in prefix_dir.iterdir():
                if not blob_file.is_file():
                    continue
                if blob_file.stat().st_nlink == 1:
                    blob_file.unlink()
                    removed += 1
            if prefix_dir.exists() and not any(prefix_dir.iterdir()):
                prefix_dir.rmdir()

        return removed
