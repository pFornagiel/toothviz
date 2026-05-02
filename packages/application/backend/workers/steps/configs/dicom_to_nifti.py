"""Configuration for the dicom_to_nifti pipeline step."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from backend.utils.dicom_zip import (
    DEFAULT_MAX_UNCOMPRESSED_ZIP_BYTES,
    DEFAULT_MAX_ZIP_MEMBERS,
)


@dataclass(frozen=True)
class DicomToNiftiStepConfig:
    max_zip_members: int = DEFAULT_MAX_ZIP_MEMBERS
    max_uncompressed_zip_bytes: int = DEFAULT_MAX_UNCOMPRESSED_ZIP_BYTES

    @classmethod
    def from_mapping(cls, data: dict[str, Any] | None) -> DicomToNiftiStepConfig:
        if not data:
            return cls()
        allowed = {"max_zip_members", "max_uncompressed_zip_bytes"}
        unknown = set[str](data) - allowed
        if unknown:
            raise ValueError(
                f"Unknown dicom_to_nifti config keys: {sorted(unknown)}"
            )
        max_zip = int(data.get("max_zip_members", cls.max_zip_members))
        max_unc = int(
            data.get("max_uncompressed_zip_bytes", cls.max_uncompressed_zip_bytes)
        )
        if max_zip < 1:
            raise ValueError("max_zip_members must be >= 1")
        if max_unc < 1:
            raise ValueError("max_uncompressed_zip_bytes must be >= 1")
        return cls(max_zip_members=max_zip, max_uncompressed_zip_bytes=max_unc)
