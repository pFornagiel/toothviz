# storage/local.py
from __future__ import annotations
import contextlib
import hashlib
import json
import os
import shutil
import time
import uuid
import nibabel as nib
from datetime import datetime
from pathlib import Path
from typing import Any, BinaryIO, Dict, Iterable, List, Optional, Tuple, Literal

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

try:
    from filelock import FileLock
except Exception:
    FileLock = None


from .abstract import AbstractPersistentStorage, StoredFile, Role
from .models import Base, Study, Blob, FileRecord, UploadSession


class LocalPersistentStorage(AbstractPersistentStorage):
    """
    Reliable local FS storage with:
      - chunked, resumable upload
      - content-addressed blob store (SHA-256) + hardlinks to per-study files
      - atomic finalize
      - SQLite with WAL
      - optional NIfTI metadata capture via nibabel
    """

    def __init__(self, root: str = "./data", sqlite_url: str = "sqlite:///storage.sqlite3"):
        self.root = Path(root).resolve()
        (self.root / "blobs" / "sha256").mkdir(parents=True, exist_ok=True)
        (self.root / "studies").mkdir(parents=True, exist_ok=True)
        (self.root / "uploads").mkdir(parents=True, exist_ok=True)

        self.engine = create_engine(sqlite_url, future=True)
        with self.engine.connect() as conn:
            if self.engine.url.get_backend_name().startswith("sqlite"):
                conn.exec_driver_sql("PRAGMA journal_mode=WAL;")
                conn.exec_driver_sql("PRAGMA synchronous=NORMAL;")
                conn.exec_driver_sql("PRAGMA foreign_keys=ON;")
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine, expire_on_commit=False)



    def _study_dir(self, study_id: str) -> Path:
        return self.root / "studies" / study_id

    def _blob_path(self, sha256: str) -> Path:
        return self.root / "blobs" / "sha256" / sha256[:2] / sha256

    def _upload_dir(self, upload_id: str) -> Path:
        return self.root / "uploads" / upload_id

    def _ensure_study_dirs(self, study_id: str) -> None:
        d = self._study_dir(study_id)
        for sub in ("raw", "derived", "thumbs", "logs"):
            (d / sub).mkdir(parents=True, exist_ok=True)

    @staticmethod
    def _now() -> datetime:
        return datetime.utcnow()

    @staticmethod
    def _safe_name(name: str) -> str:
        return os.path.basename(name)

    @staticmethod
    def _sha256_stream(f: BinaryIO, chunk: int = 8 * 1024 * 1024) -> Tuple[str, int]:
        h = hashlib.sha256()
        total = 0
        while True:
            b = f.read(chunk)
            if not b:
                break
            total += len(b)
            h.update(b)
        return h.hexdigest(), total

    def _nifti_meta_if_available(self, path: Path) -> Dict[str, Any]:
        if nib is None:
            return {}
        try:
            img = nib.load(str(path))
            hdr = img.header
            return {
                "nifti": {
                    "shape": tuple(int(x) for x in img.shape),
                    "pixdim": tuple(float(x) for x in hdr.get_zooms()),
                    "affine": img.affine.tolist(),
                }
            }
        except Exception:
            return {}


    def create_study(self, external_id: Optional[str] = None, meta: Optional[Dict[str, Any]] = None) -> str:
        sid = str(uuid.uuid4())
        with self.Session() as s:
            s.add(Study(id=sid, external_id=external_id, status="created", meta=meta or {}))
            s.commit()
        self._ensure_study_dirs(sid)
        return sid

    def ensure_study(self, study_id: str) -> None:
        with self.Session() as s:
            st = s.get(Study, study_id)
            if st is None:
                s.add(Study(id=study_id, status="created", meta={}))
                s.commit()
        self._ensure_study_dirs(study_id)

    def begin_upload(
        self,
        study_id: str,
        role: Role,
        kind: str,
        filename: str,
        content_type: Optional[str] = None,
        expected_size: Optional[int] = None,
        expected_sha256: Optional[str] = None,
    ) -> str:
        self.ensure_study(study_id)
        up_id = str(uuid.uuid4())
        up_dir = self._upload_dir(up_id)
        (up_dir / "parts").mkdir(parents=True, exist_ok=True)

        meta = {
            "study_id": study_id,
            "role": role,
            "kind": kind,
            "filename": self._safe_name(filename),
            "content_type": content_type,
            "expected_size": expected_size,
            "expected_sha256": expected_sha256,
        }
        (up_dir / "meta.json").write_text(json.dumps(meta), encoding="utf-8")

        with self.Session() as s:
            s.add(UploadSession(
                id=up_id,
                study_id=study_id,
                role=role,
                kind=kind,
                filename=meta["filename"],
                content_type=content_type,
                expected_size=expected_size,
                expected_sha256=expected_sha256,
                state="active",
            ))
            s.commit()
        return up_id

    def upload_chunk(self, upload_id: str, index: int, data: bytes) -> None:
        up_dir = self._upload_dir(upload_id)
        if not up_dir.exists():
            raise FileNotFoundError("upload session not found")

        part = up_dir / "parts" / f"part_{index:08d}.chunk"
        if part.exists() and part.stat().st_size == len(data):
            return
        part.parent.mkdir(parents=True, exist_ok=True)
        part.write_bytes(data)

    def finalize_upload(self, upload_id: str) -> StoredFile:
        up_dir = self._upload_dir(upload_id)
        if not up_dir.exists():
            raise FileNotFoundError("upload session not found")

        meta = json.loads((up_dir / "meta.json").read_text(encoding="utf-8"))
        lock = FileLock(str(up_dir / ".lock")) if FileLock else None
        if lock:
            lock.acquire(timeout=300)

        try:
            parts = sorted((up_dir / "parts").glob("part_*.chunk"))
            if not parts:
                raise RuntimeError("no parts uploaded")

            tmp_concat = up_dir / "concat.tmp"
            with open(tmp_concat, "wb") as out:
                h = hashlib.sha256()
                total = 0
                for p in parts:
                    with open(p, "rb") as fp:
                        while True:
                            b = fp.read(8 * 1024 * 1024)
                            if not b:
                                break
                            total += len(b)
                            h.update(b)
                            out.write(b)
                final_sha = h.hexdigest()
                final_size = total

            exp_size = meta.get("expected_size")
            exp_sha = meta.get("expected_sha256")
            if exp_size is not None and int(exp_size) != final_size:
                raise RuntimeError(f"size mismatch: exp={exp_size}, got={final_size}")
            if exp_sha and exp_sha != final_sha:
                raise RuntimeError(f"checksum mismatch: exp={exp_sha}, got={final_sha}")


            blob = self._blob_path(final_sha)
            blob.parent.mkdir(parents=True, exist_ok=True)
            if not blob.exists():
                os.replace(str(tmp_concat), str(blob))
            else:
                tmp_concat.unlink(missing_ok=True)


            with self.Session() as s:
                if s.get(Blob, final_sha) is None:
                    s.add(Blob(hash=final_sha, size=final_size))
                    s.commit()


            study_id = meta["study_id"]
            role = meta["role"]
            kind = meta["kind"]
            filename = self._safe_name(meta["filename"])
            subdir = "raw" if role == "original" else ("derived" if role == "derived" else "thumbs" if role == "thumb" else "logs")
            link_path = self._study_dir(study_id) / subdir / filename
            if link_path.exists():
                stem, ext = os.path.splitext(filename)
                link_path = link_path.with_name(f"{stem}_{int(time.time())}{ext}")
            try:
                os.link(str(blob), str(link_path))  # hardlink
            except Exception:
                shutil.copy2(str(blob), str(link_path))  # fallback


            file_meta: Dict[str, Any] = {}
            if (kind in ("nifti", "segmentation", "denoise") and
                (str(link_path).endswith(".nii") or str(link_path).endswith(".nii.gz"))):
                file_meta.update(self._nifti_meta_if_available(link_path))

            with self.Session() as s:
                rec = FileRecord(
                    id=str(uuid.uuid4()),
                    study_id=study_id,
                    role=role,
                    kind=kind,
                    rel_path=str(link_path.relative_to(self.root)),
                    blob_hash=final_sha,
                    content_type=meta.get("content_type"),
                    size=final_size,
                    checksum_sha256=final_sha,
                    created_at=self._now(),
                    meta=file_meta,
                )
                s.add(rec)
                sess = s.get(UploadSession, upload_id)
                sess.state = "finalized"
                s.commit()
                return StoredFile(
                    id=rec.id,
                    study_id=rec.study_id,
                    role=rec.role,
                    kind=rec.kind,
                    rel_path=rec.rel_path,
                    size=rec.size,
                    checksum_sha256=rec.checksum_sha256,
                    blob_hash=rec.blob_hash,
                    content_type=rec.content_type,
                    created_at=rec.created_at,
                    meta=rec.meta,
                )
        finally:
            #cleanup
            try:
                shutil.rmtree(up_dir / "parts", ignore_errors=True)
            except Exception:
                pass
            if lock:
                try:
                    lock.release()
                except Exception:
                    pass

    def store_from_local_path(
        self,
        study_id: str,
        role: Role,
        kind: str,
        src_path: str,
        filename: Optional[str] = None,
        content_type: Optional[str] = None,
        meta: Optional[Dict[str, Any]] = None,
    ) -> StoredFile:
        self.ensure_study(study_id)
        src = Path(src_path)
        if not src.exists():
            raise FileNotFoundError(src_path)

        with open(src, "rb") as f:
            sha, size = self._sha256_stream(f)

        blob = self._blob_path(sha)
        blob.parent.mkdir(parents=True, exist_ok=True)
        if not blob.exists():
            tmp = blob.with_suffix(".tmp")
            shutil.copy2(str(src), str(tmp))
            os.replace(str(tmp), str(blob))

        with self.Session() as s:
            if s.get(Blob, sha) is None:
                s.add(Blob(hash=sha, size=size))
                s.commit()

        subdir = "raw" if role == "original" else ("derived" if role == "derived" else "thumbs" if role == "thumb" else "logs")
        target_name = self._safe_name(filename or src.name)
        link_path = self._study_dir(study_id) / subdir / target_name
        if link_path.exists():
            stem, ext = os.path.splitext(target_name)
            link_path = link_path.with_name(f"{stem}_{int(time.time())}{ext}")
        try:
            os.link(str(blob), str(link_path))
        except Exception:
            shutil.copy2(str(blob), str(link_path))

        file_meta = meta or {}
        if (kind in ("nifti", "segmentation", "denoise") and
            (str(link_path).endswith(".nii") or str(link_path).endswith(".nii.gz"))):
            file_meta.update(self._nifti_meta_if_available(link_path))

        with self.Session() as s:
            rec = FileRecord(
                id=str(uuid.uuid4()),
                study_id=study_id,
                role=role,
                kind=kind,
                rel_path=str(link_path.relative_to(self.root)),
                blob_hash=sha,
                content_type=content_type,
                size=size,
                checksum_sha256=sha,
                created_at=self._now(),
                meta=file_meta,
            )
            s.add(rec); s.commit()
            return StoredFile(
                id=rec.id,
                study_id=rec.study_id,
                role=rec.role,
                kind=rec.kind,
                rel_path=rec.rel_path,
                size=rec.size,
                checksum_sha256=rec.checksum_sha256,
                blob_hash=rec.blob_hash,
                content_type=rec.content_type,
                created_at=rec.created_at,
                meta=rec.meta,
            )

    def get_file(self, file_id: str) -> StoredFile:
        with self.Session() as s:
            rec = s.get(FileRecord, file_id)
            if rec is None:
                raise FileNotFoundError(file_id)
            return StoredFile(
                id=rec.id, study_id=rec.study_id, role=rec.role, kind=rec.kind,
                rel_path=rec.rel_path, size=rec.size, checksum_sha256=rec.checksum_sha256,
                blob_hash=rec.blob_hash, content_type=rec.content_type, created_at=rec.created_at, meta=rec.meta
            )

    def list_files(self, study_id: str, role: Optional[Role] = None, kind: Optional[str] = None) -> List[StoredFile]:
        with self.Session() as s:
            q = s.query(FileRecord).filter(FileRecord.study_id == study_id)
            if role:
                q = q.filter(FileRecord.role == role)
            if kind:
                q = q.filter(FileRecord.kind == kind)
            rows = q.order_by(FileRecord.created_at.asc()).all()
            return [
                StoredFile(
                    id=r.id, study_id=r.study_id, role=r.role, kind=r.kind, rel_path=r.rel_path,
                    size=r.size, checksum_sha256=r.checksum_sha256, blob_hash=r.blob_hash,
                    content_type=r.content_type, created_at=r.created_at, meta=r.meta
                ) for r in rows
            ]

    @contextlib.contextmanager
    def open_file(self, file_id: str):
        f = self.get_file(file_id)
        path = self.root / f.rel_path
        with open(path, "rb") as fh:
            yield fh

    def save_metadata(self, study_id: str, meta: Dict[str, Any], merge: bool = True) -> None:
        with self.Session() as s:
            st = s.get(Study, study_id)
            if st is None:
                raise KeyError(f"study not found: {study_id}")
            st.meta = {**(st.meta or {}), **meta} if merge else (meta or {})
            s.commit()

    def get_metadata(self, study_id: str) -> Dict[str, Any]:
        with self.Session() as s:
            st = s.get(Study, study_id)
            if st is None:
                raise KeyError(f"study not found: {study_id}")
            return st.meta or {}

    def delete_file(self, file_id: str) -> None:
        with self.Session() as s:
            rec = s.get(FileRecord, file_id)
            if rec is None:
                return
            if rec.role == "original":
                raise PermissionError("Refusing to delete original file")
            # unlink study reference (blob remains until GC)
            try:
                (self.root / rec.rel_path).unlink(missing_ok=True)
            except Exception:
                pass
            s.delete(rec); s.commit()

    def garbage_collect(self, dry_run: bool = True) -> Dict[str, Any]:
        """
        Remove blob files that are not referenced by any FileRecord.
        Returns list of orphan hashes for observability.
        """
        with self.Session() as s:
            referenced = {h for (h,) in s.query(FileRecord.blob_hash).distinct().all()}
            removed: List[str] = []
            for blob in s.query(Blob).all():
                if blob.hash in referenced:
                    continue
                blob_path = self._blob_path(blob.hash)
                if not dry_run:
                    try:
                        blob_path.unlink(missing_ok=True)
                    except Exception:
                        pass
                    s.delete(blob); s.commit()
                removed.append(blob.hash)
        return {"orphans": removed, "dry_run": dry_run}

    def dispose(self) -> None:
        self.engine.dispose()