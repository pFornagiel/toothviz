from __future__ import annotations
from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime
from typing import Any, BinaryIO, Dict, Iterable, List, Literal, Optional, Protocol
import contextlib


Role = Literal["original", "derived", "thumb", "log"]


@dataclass(frozen=True)
class StoredFile:
    """
    Canonical representation of a stored file/artifact.
    """
    id: str
    study_id: str
    role: Role
    kind: Optional[str]
    rel_path: str
    size: int
    checksum_sha256: str
    blob_hash: str
    content_type: Optional[str]
    created_at: datetime
    meta: Dict[str, Any]


class AbstractPersistentStorage(ABC):
    """
    Abstract, reliable storage API for large medical volumes (NIfTI) and derivatives.
    Concrete backends (local FS, S3, etc.) must implement this interface.
    """

    @abstractmethod
    def create_study(self, external_id: Optional[str] = None, meta: Optional[Dict[str, Any]] = None) -> str: ...

    @abstractmethod
    def ensure_study(self, study_id: str) -> None: ...

    @abstractmethod
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
        """
        Initiate an upload session. Returns upload_id.
        """

    @abstractmethod
    def upload_chunk(self, upload_id: str, index: int, data: bytes) -> None: ...

    @abstractmethod
    def finalize_upload(self, upload_id: str) -> StoredFile: ...

    @abstractmethod
    def store_from_local_path(
        self,
        study_id: str,
        role: Role,
        kind: str,
        src_path: str,
        filename: Optional[str] = None,
        content_type: Optional[str] = None,
        meta: Optional[Dict[str, Any]] = None,
    ) -> StoredFile: ...

    @abstractmethod
    def get_file(self, file_id: str) -> StoredFile: ...

    @abstractmethod
    def list_files(self, study_id: str, role: Optional[Role] = None, kind: Optional[str] = None) -> List[StoredFile]: ...

    @abstractmethod
    def open_file(self, file_id: str) -> contextlib.AbstractContextManager[BinaryIO]: ...

    @abstractmethod
    def save_metadata(self, study_id: str, meta: Dict[str, Any], merge: bool = True) -> None: ...

    @abstractmethod
    def get_metadata(self, study_id: str) -> Dict[str, Any]: ...

    @abstractmethod
    def delete_file(self, file_id: str) -> None: ...

    @abstractmethod
    def garbage_collect(self, dry_run: bool = True) -> Dict[str, Any]: ...

    @abstractmethod
    def dispose(self) -> None: ...