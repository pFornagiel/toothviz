"""
Dummy/fast segmentation for testing purposes.
Returns random multi-class masks (0-32 classes: background + 32 teeth) instantly without any ML inference.

This is used when SEGMENTATION_MODE=dummy to speed up testing of other app functionality.
"""

from __future__ import annotations

import logging
from pathlib import Path

import nibabel as nib
import numpy as np
from backend.workers.steps.configs import SegmentNiftiStepConfig

logger = logging.getLogger(__name__)


def run_segmentation(
    input_nifti_path: str,
    out_dir: str,
    config: SegmentNiftiStepConfig
    ) -> str:
    """
    Fast dummy segmentation that creates a random binary mask.
    
    Returns the mask path (str) instantly.
    Perfect for testing the rest of the app without waiting for real segmentation.
    
    Args:
        input_nifti_path: Path to input NIfTI file
        out_dir: Output directory for the mask
        
    Returns:
        Path to the generated mask file
    """
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    
    logger.info(f"[DUMMY MODE] Loading NIfTI from {input_nifti_path}")
    img = nib.load(input_nifti_path)
    image_data = np.asarray(img.get_fdata(dtype=np.float32))
    
    # Handle 4D images (e.g., with singleton dimension)
    if image_data.ndim == 4 and image_data.shape[-1] == 1:
        image_data = image_data[..., 0]
    if image_data.ndim != 3:
        raise ValueError(
            f"Expected 3D volume; got shape {image_data.shape!r}"
        )
    
    # Create a random multi-class mask (33 classes: 0=background, 1-32=teeth)
    logger.info(f"[DUMMY MODE] Generating random 33-class mask for shape {image_data.shape}")
    mask = np.random.randint(0, 33, size=image_data.shape, dtype=np.uint8)
    
    # Save the mask
    mask_img = nib.Nifti1Image(mask, affine=img.affine)
    mask_img.header.set_data_dtype(np.uint8)
    
    output_path = out / "segmentation_mask.nii.gz"
    logger.info(f"[DUMMY MODE] Saving dummy mask to {output_path}")
    nib.save(mask_img, str(output_path))
    
    logger.info(f"[DUMMY MODE] Dummy segmentation completed instantly!")
    return str(output_path)


def _init_segmentation_dummy(model_path: str = None, execution_providers: tuple[str, ...] = None) -> None:
    """
    Dummy initializer - does nothing but follows the same interface as the real one.
    Called once per worker process for consistency.
    """
    from backend.logging import setup_logging
    setup_logging("segmentation_worker_dummy")
    logger.info("[DUMMY MODE] Dummy segmentation worker initialized")
