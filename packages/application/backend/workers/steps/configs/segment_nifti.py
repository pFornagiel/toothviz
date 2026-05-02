"""Configuration for the segment_nifti pipeline step."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


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
