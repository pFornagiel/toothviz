"""Configuration for the segment_nifti pipeline step."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class SegmentNiftiStepConfig:
    target_spacing: tuple[float, float, float] = (0.3, 0.3, 0.3)
    # nnUNetTrainer_onlyMirror01_DASegOrd0__nnUNetPlans__3d_fullres_resample_torch_256_bs8_ctnorm
    patch_size: tuple[int, int, int] = (256, 256, 256)
    clip_min: float = -113.79613494873047    # percentile_00_5
    clip_max: float = 4021.0                 # percentile_99_5
    apply_z_score: bool = True
    intensity_mean: float = 1921.5234230332373
    intensity_std: float = 686.8805465431079
    
    tile_step_size: float = 0.9
    @classmethod
    def from_mapping(cls, data: dict[str, Any] | None) -> SegmentNiftiStepConfig:
        if not data:
            return cls()
        
        allowed_keys = {
            "target_spacing", "patch_size", "clip_min", "clip_max",
            "apply_z_score", "intensity_mean", "intensity_std", "tile_step_size"
        }
        unknown = set(data) - allowed_keys
        if unknown:
            raise ValueError(f"Unknown segment_nifti config keys: {sorted(unknown)}")
            
        kwargs = {}
        if "target_spacing" in data:
            kwargs["target_spacing"] = tuple(float(x) for x in data["target_spacing"])
        if "patch_size" in data:
            kwargs["patch_size"] = tuple(int(x) for x in data["patch_size"])
        if "clip_min" in data:
            kwargs["clip_min"] = float(data["clip_min"])
        if "clip_max" in data:
            kwargs["clip_max"] = float(data["clip_max"])
        if "apply_z_score" in data:
            kwargs["apply_z_score"] = bool(data["apply_z_score"])
        if "intensity_mean" in data:
            kwargs["intensity_mean"] = float(data["intensity_mean"])
        if "intensity_std" in data:
            kwargs["intensity_std"] = float(data["intensity_std"])
        if "tile_step_size" in data:
            kwargs["tile_step_size"] = float(data["tile_step_size"])

        return cls(**kwargs)
