"""Configuration for the dicom_to_nifti pipeline step."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from backend.dicom import (
    DEFAULT_MAX_UNCOMPRESSED_ZIP_BYTES,
    DEFAULT_MAX_VOLUME_BYTES,
    DEFAULT_MAX_ZIP_MEMBERS,
)

_KEYS = ("max_zip_members", "max_uncompressed_zip_bytes", "max_volume_bytes")


@dataclass(frozen=True)
class DicomToNiftiStepConfig:
    max_zip_members: int = DEFAULT_MAX_ZIP_MEMBERS
    max_uncompressed_zip_bytes: int = DEFAULT_MAX_UNCOMPRESSED_ZIP_BYTES
    max_volume_bytes: int = DEFAULT_MAX_VOLUME_BYTES

    @classmethod
    def from_mapping(cls, data: dict[str, Any] | None) -> DicomToNiftiStepConfig:
        if not data:
            return cls()
        unknown = set[str](data) - set(_KEYS)
        if unknown:
            raise ValueError(
                f"Unknown dicom_to_nifti config keys: {sorted(unknown)}"
            )
        values = {key: int(data.get(key, getattr(cls, key))) for key in _KEYS}
        for key, value in values.items():
            if value < 1:
                raise ValueError(f"{key} must be >= 1")
        return cls(**values)
