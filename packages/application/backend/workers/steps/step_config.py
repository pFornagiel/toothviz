"""Typed configuration for pipeline steps (validated, no silent ignores)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

__all__ = [
    "DicomToNiftiStepConfig",
    "SegmentNiftiStepConfig",
]


@dataclass(frozen=True)
class DicomToNiftiStepConfig:
    max_zip_members: int = 10_000
    max_uncompressed_zip_bytes: int = 500 * 1024 * 1024

    @classmethod
    def from_mapping(cls, data: dict[str, Any] | None) -> DicomToNiftiStepConfig:
        if not data:
            return cls()
        allowed = {"max_zip_members", "max_uncompressed_zip_bytes"}
        unknown = set(data) - allowed
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


@dataclass(frozen=True)
class SegmentNiftiStepConfig:
    threshold: float = 0.5
    pad_multiple: int = 16

    @classmethod
    def from_mapping(cls, data: dict[str, Any] | None) -> SegmentNiftiStepConfig:
        if not data:
            return cls()
        allowed = {"threshold", "pad_multiple"}
        unknown = set(data) - allowed
        if unknown:
            raise ValueError(
                f"Unknown segment_nifti config keys: {sorted(unknown)}"
            )
        threshold = float(data.get("threshold", cls.threshold))
        pad_multiple = int(data.get("pad_multiple", cls.pad_multiple))
        if not (0.0 < threshold <= 1.0):
            raise ValueError("threshold must be in (0, 1]")
        if pad_multiple < 1:
            raise ValueError("pad_multiple must be >= 1")
        return cls(threshold=threshold, pad_multiple=pad_multiple)
