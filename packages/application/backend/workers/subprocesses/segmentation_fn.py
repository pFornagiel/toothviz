"""Pure compute: ONNX segmentation inference on a NIfTI file.

Runs in a subprocess via WorkerPool. Receives and returns plain strings only.
The model is loaded once per worker process via _init_segmentation().
"""
from __future__ import annotations
from backend.workers.subprocesses._onnx_helpers import load_onnx_model

from pathlib import Path

import numpy as np
import nibabel as nib

_model = None


def _init_segmentation(model_path: str) -> None:
    """Process-level initializer — called once per worker process."""
    global _model
    
    _model = load_onnx_model(model_path)


def run_segmentation(input_nifti_path: str, out_dir: str) -> str:
    """Run segmentation inference. Returns the mask path (str)."""
    
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)

    img = nib.load(input_nifti_path)
    image_data = np.asarray(img.get_fdata())

    mask = _predict(image_data)
    mask_img = nib.Nifti1Image(mask, affine=img.affine, header=img.header)

    output_path = out / "segmentation_mask.nii.gz"
    nib.save(mask_img, str(output_path))
    return str(output_path)


def _predict(image_data: np.ndarray) -> np.ndarray:
    """Run the ONNX model on volumetric data."""
    if _model is None:
        raise RuntimeError("segmentation model not initialized — call _init_segmentation first")

    padded, pads = _pad_to_multiple(image_data, 16)
    input_data = padded.astype(np.float32)
    input_data = np.expand_dims(input_data, axis=0)  # batch
    input_data = np.expand_dims(input_data, axis=0)  # channel

    input_name = _model.get_inputs()[0].name
    raw_output = _model.run(None, {input_name: input_data})[0]
    mask_probs = raw_output[0][0]
    mask_probs = _unpad(mask_probs, pads)
    return (mask_probs > 0.5).astype(np.uint8)


def _pad_to_multiple(data: np.ndarray, multiple: int = 16):
    pad_widths = []
    for s in data.shape:
        remainder = s % multiple
        if remainder == 0:
            pad_widths.append((0, 0))
        else:
            diff = multiple - remainder
            pad_widths.append((diff // 2, diff - diff // 2))
    return np.pad(data, pad_widths, mode="constant", constant_values=data.min()), pad_widths


def _unpad(data: np.ndarray, pad_widths: list):
    slices = tuple(
        slice(p[0], -p[1] if p[1] != 0 else None) for p in pad_widths
    )
    return data[slices]
