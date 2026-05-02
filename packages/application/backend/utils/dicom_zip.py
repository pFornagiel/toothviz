"""Shared DICOM pipeline ZIP guards and extraction."""

from __future__ import annotations

import shutil
import zipfile
from pathlib import Path

DEFAULT_MAX_ZIP_MEMBERS = 10_000
DEFAULT_MAX_UNCOMPRESSED_ZIP_BYTES = 500 * 1024 * 1024


def safe_extract_zip(
    zip_path: Path,
    dest_dir: Path,
    *,
    max_members: int = DEFAULT_MAX_ZIP_MEMBERS,
    max_uncompressed_bytes: int = DEFAULT_MAX_UNCOMPRESSED_ZIP_BYTES,
) -> None:
    """Extract a ZIP into ``dest_dir`` with size and path-safety checks.

    Rejects archives with too many entries or too much total uncompressed size,
    or any member whose resolved path would leave ``dest_dir``. Directory
    entries in the archive are skipped; files are written.

    Raises:
        ValueError: Limits exceeded or an unsafe member path.
    """
    dest_dir = dest_dir.resolve()
    dest_dir.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(zip_path) as zf:
        infos = zf.infolist()
        if len(infos) > max_members:
            raise ValueError(
                f"ZIP contains too many members ({len(infos)} > {max_members})"
            )
        total_uncompressed = sum(i.file_size for i in infos if not i.is_dir())
        if total_uncompressed > max_uncompressed_bytes:
            raise ValueError(
                "ZIP uncompressed size exceeds configured limit "
                f"({total_uncompressed} > {max_uncompressed_bytes})"
            )

        to_extract: list[tuple[zipfile.ZipInfo, Path]] = []
        for info in infos:
            if info.is_dir():
                continue
            target = (dest_dir / Path(info.filename)).resolve()
            try:
                target.relative_to(dest_dir)
            except ValueError:
                raise ValueError(
                    f"ZIP path escapes destination: {info.filename!r}"
                ) from None
            to_extract.append((info, target))

        for info, target in to_extract:
            target.parent.mkdir(parents=True, exist_ok=True)
            with zf.open(info, "r") as src, open(target, "wb") as dst:
                shutil.copyfileobj(src, dst, length=1024 * 1024)


def extract_zip_to_fresh_dir(
    zip_path: Path,
    dest_dir: Path,
    *,
    max_members: int = DEFAULT_MAX_ZIP_MEMBERS,
    max_uncompressed_bytes: int = DEFAULT_MAX_UNCOMPRESSED_ZIP_BYTES,
) -> None:
    """Remove ``dest_dir`` if present, recreate it, then :func:`safe_extract_zip`."""
    shutil.rmtree(dest_dir, ignore_errors=True)
    dest_dir.mkdir(parents=True, exist_ok=True)
    safe_extract_zip(
        zip_path,
        dest_dir,
        max_members=max_members,
        max_uncompressed_bytes=max_uncompressed_bytes,
    )


def resolve_dicom_input_root(
    input_path: Path,
    zip_extract_dir: Path,
    *,
    max_members: int = DEFAULT_MAX_ZIP_MEMBERS,
    max_uncompressed_bytes: int = DEFAULT_MAX_UNCOMPRESSED_ZIP_BYTES,
) -> Path:
    """Return a filesystem root for locating DICOM files.

    If ``input_path`` is a ZIP archive, extracts into ``zip_extract_dir`` (replacing
    any existing directory) and returns that directory. Otherwise returns
    ``input_path`` unchanged (file or directory).
    """
    if not input_path.is_file():
        return input_path
    if zipfile.is_zipfile(input_path):
        extract_zip_to_fresh_dir(
            input_path,
            zip_extract_dir,
            max_members=max_members,
            max_uncompressed_bytes=max_uncompressed_bytes,
        )
        return zip_extract_dir
    return input_path


def populate_dir_from_zip_or_file(
    src: Path,
    dest_dir: Path,
    *,
    max_members: int = DEFAULT_MAX_ZIP_MEMBERS,
    max_uncompressed_bytes: int = DEFAULT_MAX_UNCOMPRESSED_ZIP_BYTES,
) -> None:
    """Fill ``dest_dir`` from a ZIP (guarded extract) or copy a single file into it.

    Caller must prepare ``dest_dir`` (typically empty).
    """
    if not src.is_file():
        raise FileNotFoundError(f"DICOM input not found: {src}")
    if zipfile.is_zipfile(src):
        safe_extract_zip(
            src,
            dest_dir,
            max_members=max_members,
            max_uncompressed_bytes=max_uncompressed_bytes,
        )
    else:
        shutil.copy2(src, dest_dir / src.name)


def zip_directory(root_dir: Path, zip_file: Path) -> Path:
    """Zip the tree under ``root_dir`` and write ``zip_file`` (``.zip`` extension).

    Uses :func:`shutil.make_archive`; any existing ``zip_file`` is replaced.
    Returns the path to the created archive (normally ``zip_file`` resolved).
    """
    zip_file = zip_file.resolve()
    zip_file.unlink(missing_ok=True)
    archive_base = zip_file.with_suffix("")
    created = shutil.make_archive(
        str(archive_base), "zip", root_dir=str(root_dir.resolve())
    )
    return Path(created)
