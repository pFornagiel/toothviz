import numpy as np
import logging
import nibabel as nib
import tempfile
from contextlib import contextmanager
import os

logger = logging.getLogger(__name__)

def predict(image_data: np.ndarray) -> np.ndarray:
    # TODO: this is a mockup ofc
    mask = (image_data > 128.0).astype(np.uint8)
    return mask


def create_mask_file(input_path: str, output_path: str) -> np.ndarray:
    logger.info(f"Loading NIfTI image from: {input_path}")
    img = nib.load(input_path)
    image_data = np.asarray(img.get_fdata())
    
    mask = predict(image_data)
    mask_img = nib.Nifti1Image(mask, affine=img.affine, header=img.header)
    
    nib.save(mask_img, output_path)
    return mask

@contextmanager
def run_inference(input_path: str):
    logger.info("Starting inference pipeline")
    with tempfile.NamedTemporaryFile(suffix=".nii.gz", delete=False) as tmp:
        output_path = tmp.name
    
    try:
        create_mask_file(input_path, output_path)
        logger.info("Inference completed successfully")
        
        yield output_path
    finally:
        if os.path.exists(output_path):
            try:
                os.remove(output_path)
                logger.info(f"Engine cleaned up temp file: {output_path}")
            except OSError as e:
                logger.error(f"Failed to delete temp file {output_path}: {e}")