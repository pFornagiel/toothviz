"""Enumerate candidate DICOM files in an upload without extracting it.

An upload is a ZIP archive, a single file, or (for tests and tooling) a
directory. ZIP members are read in place through ``zipfile``, so nothing is
written to disk and member paths are never used as filesystem paths, which
removes the path-traversal and disk-space failure modes of extraction.
"""

from __future__ import annotations

import os
import zipfile
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath
from typing import BinaryIO

from backend.dicom.errors import DicomConversionError

DEFAULT_MAX_ZIP_MEMBERS = 50_000
# Guards against ZIP bombs only. A real CBCT is ~0.1-2 GB of pixel data; the
# volume size itself is limited separately (see ``DEFAULT_MAX_VOLUME_BYTES``).
DEFAULT_MAX_UNCOMPRESSED_ZIP_BYTES = 16 * 1024**3

# Stored, deflate, bzip2, lzma - what CPython's zipfile can read.
_SUPPORTED_ZIP_METHODS = {
    zipfile.ZIP_STORED,
    zipfile.ZIP_DEFLATED,
    zipfile.ZIP_BZIP2,
    zipfile.ZIP_LZMA,
}
_ZIP_METHOD_NAMES = {9: "Deflate64", 99: "AES encryption"}

# OS metadata that archivers add next to the real files.
_JUNK_DIRS = {"__macosx"}
_JUNK_NAMES = {".ds_store", "thumbs.db", "desktop.ini"}

# Files that are never DICOM. Skipping them by name avoids opening the viewer
# programs, documents and previews that CD/USB exports of CBCT scans include.
_NON_DICOM_SUFFIXES = {
    ".7z", ".avi", ".bat", ".bmp", ".cab", ".chm", ".cmd", ".css", ".csv",
    ".dll", ".doc", ".docx", ".exe", ".gif", ".gz", ".htm", ".html", ".ico",
    ".inf", ".ini", ".jpeg", ".jpg", ".js", ".json", ".lnk", ".mp4", ".msi",
    ".nii", ".ocx", ".pdf", ".png", ".rar", ".rtf", ".stl", ".sys", ".tif",
    ".tiff", ".txt", ".url", ".xml", ".zip",
}


@dataclass(frozen=True)
class DicomSource:
    """One file that may contain DICOM; ``open`` returns a fresh binary stream."""

    name: str
    size: int
    _opener: Callable[[], BinaryIO] = field(repr=False, compare=False)

    @property
    def base_name(self) -> str:
        """File name without directories (safe to show; folders may name the patient)."""
        return PurePosixPath(self.name).name

    def open(self) -> BinaryIO:
        return self._opener()


@dataclass
class SourceListing:
    sources: list[DicomSource]
    skipped_metadata: int = 0
    skipped_by_name: int = 0


def _is_os_metadata(name: str) -> bool:
    parts = PurePosixPath(name.replace("\\", "/")).parts
    if any(p.lower() in _JUNK_DIRS for p in parts[:-1]):
        return True
    base = parts[-1] if parts else ""
    return base.startswith("._") or base.lower() in _JUNK_NAMES


def _is_known_non_dicom(name: str) -> bool:
    return PurePosixPath(name).suffix.lower() in _NON_DICOM_SUFFIXES


def _looks_like_truncated_zip(path: Path) -> bool:
    with open(path, "rb") as fh:
        return fh.read(4) == b"PK\x03\x04"


def _filter(names_sizes_openers) -> SourceListing:
    listing = SourceListing(sources=[])
    for name, size, opener in names_sizes_openers:
        if _is_os_metadata(name):
            listing.skipped_metadata += 1
        elif _is_known_non_dicom(name):
            listing.skipped_by_name += 1
        elif size > 0:
            listing.sources.append(DicomSource(name=name, size=size, _opener=opener))
    return listing


def _zip_listing(
    zf: zipfile.ZipFile,
    *,
    max_members: int,
    max_uncompressed_bytes: int,
) -> SourceListing:
    infos = [i for i in zf.infolist() if not i.is_dir()]
    if len(infos) > max_members:
        raise DicomConversionError(
            f"The ZIP archive contains too many files ({len(infos)}; the limit is "
            f"{max_members})."
        )
    total = sum(i.file_size for i in infos)
    if total > max_uncompressed_bytes:
        raise DicomConversionError(
            f"The ZIP archive unpacks to {total / 1024**3:.1f} GB, above the "
            f"{max_uncompressed_bytes / 1024**3:.1f} GB limit."
        )

    def entries():
        for info in infos:
            yield info.filename, info.file_size, (lambda i=info: zf.open(i, "r"))

    listing = _filter(entries())
    by_name = {i.filename: i for i in infos}
    for src in listing.sources:
        info = by_name[src.name]
        if info.flag_bits & 0x1:
            raise DicomConversionError(
                "The ZIP archive is password-protected. Export it again without a password."
            )
        if info.compress_type not in _SUPPORTED_ZIP_METHODS:
            method = _ZIP_METHOD_NAMES.get(info.compress_type, f"method {info.compress_type}")
            raise DicomConversionError(
                f"The ZIP archive uses an unsupported compression ({method}). "
                "Re-create it with standard ZIP compression (for example with "
                "7-Zip or the macOS 'Compress' option)."
            )
    return listing


def _dir_listing(root: Path) -> SourceListing:
    def entries():
        for dirpath, _dirs, files in os.walk(root):
            for fname in sorted(files):
                full = Path(dirpath) / fname
                rel = full.relative_to(root).as_posix()
                yield rel, full.stat().st_size, (lambda p=full: open(p, "rb"))

    return _filter(entries())


@contextmanager
def open_dicom_sources(
    input_path: Path,
    *,
    max_members: int = DEFAULT_MAX_ZIP_MEMBERS,
    max_uncompressed_bytes: int = DEFAULT_MAX_UNCOMPRESSED_ZIP_BYTES,
) -> Iterator[SourceListing]:
    """Yield the candidate files of an upload; streams stay valid inside the block."""
    if input_path.is_dir():
        yield _dir_listing(input_path)
        return
    if not input_path.is_file():
        raise FileNotFoundError(f"DICOM input not found: {input_path}")

    if zipfile.is_zipfile(input_path):
        try:
            zf = zipfile.ZipFile(input_path)
        except (zipfile.BadZipFile, OSError) as exc:
            raise DicomConversionError(
                "The ZIP archive is damaged and cannot be opened. Create or download it again."
            ) from exc
        with zf:
            yield _zip_listing(
                zf,
                max_members=max_members,
                max_uncompressed_bytes=max_uncompressed_bytes,
            )
        return

    if _looks_like_truncated_zip(input_path):
        raise DicomConversionError(
            "The ZIP archive is incomplete: its file index is missing, which "
            "usually means the download or copy was interrupted. Download or "
            "copy it again and retry."
        )

    size = input_path.stat().st_size
    yield SourceListing(
        sources=[
            DicomSource(
                name=input_path.name,
                size=size,
                _opener=lambda: open(input_path, "rb"),
            )
        ]
    )
