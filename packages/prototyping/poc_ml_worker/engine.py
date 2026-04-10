import numpy as np
import logging
import nibabel as nib
import tempfile
from contextlib import contextmanager
import os
import onnxruntime as ort

logger = logging.getLogger(__name__)

def _pad_to_multiple(data: np.ndarray, multiple: int = 16) -> tuple[np.ndarray, tuple]:
    """Potrzebne żeby wymiary sie zgadzaly. zvibeowane na szybko"""
    org_shape = data.shape
    pad_widths = []
    for s in org_shape:
        remainder = s % multiple
        if remainder == 0:
            pad_widths.append((0, 0))
        else:
            diff = multiple - remainder
            pad_widths.append((diff // 2, diff - diff // 2))
    
    padded_data = np.pad(data, pad_widths, mode='constant', constant_values=data.min())
    return padded_data, pad_widths

def _unpad(data: np.ndarray, pad_widths: list) -> np.ndarray:
    """Usuwa dopełnienie, przywracając oryginalny rozmiar."""
    slices = tuple(slice(p[0], -p[1] if p[1] != 0 else None) for p in pad_widths)
    return data[slices]

def predict(ml_model: ort.InferenceSession, image_data: np.ndarray) -> np.ndarray:
    padded_data, pads = _pad_to_multiple(image_data, 16)
    input_data = padded_data.astype(np.float32)
    
    input_data = np.expand_dims(input_data, axis=0) # Batch
    input_data = np.expand_dims(input_data, axis=0) # Channel
    
    input_name = ml_model.get_inputs()[0].name
    
    raw_output = ml_model.run(None, {input_name: input_data})[0]

    batch_result = raw_output[0] 
    logger.info(f"Output's shape: {raw_output.shape}")
    mask_probs = batch_result[0] 

    final_mask_probs = _unpad(mask_probs, pads)
    
    mask = (final_mask_probs > 0.5).astype(np.uint8) 
    return mask


def create_mask_file(input_path: str, output_path: str, ml_model: ort.InferenceSession) -> np.ndarray:
    logger.info(f"Loading NIfTI image from: {input_path}")
    img = nib.load(input_path)
    image_data = np.asarray(img.get_fdata())
    
    mask = predict(ml_model, image_data)
    mask_img = nib.Nifti1Image(mask, affine=img.affine, header=img.header)
    
    nib.save(mask_img, output_path)
    return mask

@contextmanager
def run_inference(input_path: str, ml_model: ort.InferenceSession):
    logger.info("Starting inference pipeline")
    with tempfile.NamedTemporaryFile(suffix=".nii.gz", delete=False) as tmp:
        output_path = tmp.name
    
    try:
        create_mask_file(input_path, output_path, ml_model)
        logger.info("Inference completed successfully")
        
        yield output_path
    finally:
        if os.path.exists(output_path):
            try:
                os.remove(output_path)
                logger.info(f"Engine cleaned up temp file: {output_path}")
            except OSError as e:
                logger.error(f"Failed to delete temp file {output_path}: {e}")