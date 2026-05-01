"""Pure compute: ONNX segmentation inference on a NIfTI file.

Runs in a subprocess via WorkerPool. Receives and returns plain strings only.
The model is loaded once per worker process via _init_segmentation().
"""
from __future__ import annotations

from pathlib import Path

import nibabel as nib
import numpy as np

from backend.workers.subprocesses._onnx_helpers import load_onnx_model

_model = None


def _init_segmentation(model_path: str, execution_providers: tuple[str, ...]) -> None:
    """Process-level initializer — called once per worker process."""
    global _model

    providers = list(execution_providers) if execution_providers else None
    _model = load_onnx_model(model_path, providers=providers)


def run_segmentation(
    input_nifti_path: str,
    out_dir: str,
    threshold: float,
    pad_multiple: int,
) -> str:
    """Run segmentation inference. Returns the mask path (str)."""
    if _model is None:
        raise RuntimeError(
            "segmentation model not initialized — call _init_segmentation first"
        )

    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)

    img = nib.load(input_nifti_path)
    image_data = np.asarray(img.get_fdata(dtype=np.float32))

    if image_data.ndim == 4 and image_data.shape[-1] == 1:
        image_data = image_data[..., 0]
    if image_data.ndim != 3:
        raise ValueError(
            f"segmentation expects a 3D volume; got shape {image_data.shape!r}"
        )

    mask = _predict(image_data, threshold=threshold, pad_multiple=pad_multiple)
    mask_img = nib.Nifti1Image(mask.astype(np.uint8), affine=img.affine)
    mask_img.header.set_data_dtype(np.uint8)

    output_path = out / "segmentation_mask.nii.gz"
    nib.save(mask_img, str(output_path))
    return str(output_path)


def _predict(
    image_data: np.ndarray,
    *,
    threshold: float,
    pad_multiple: int,
) -> np.ndarray:
    if _model is None:
        raise RuntimeError("segmentation model not initialized")

    padded, pads = _pad_to_multiple(image_data, pad_multiple)
    input_data = padded.astype(np.float32)
    input_data = np.expand_dims(input_data, axis=0)  # batch
    input_data = np.expand_dims(input_data, axis=0)  # channel

    input_name = _model.get_inputs()[0].name
    raw_output = _model.run(None, {input_name: input_data})[0]
    mask_probs = np.asarray(raw_output, dtype=np.float32)

    while mask_probs.ndim > 3:
        if mask_probs.shape[0] != 1:
            raise ValueError(
                "unexpected ONNX probability tensor shape "
                f"{mask_probs.shape!r}; expected leading singleton axes only"
            )
        mask_probs = mask_probs[0]

    if mask_probs.shape != padded.shape:
        raise ValueError(
            f"ONNX output spatial shape {mask_probs.shape!r} does not match "
            f"padded input {padded.shape!r}"
        )

    mask_probs = _unpad(mask_probs, pads)
    if mask_probs.shape != image_data.shape:
        raise RuntimeError("internal error: unpad did not restore input shape")
    return (mask_probs > threshold).astype(np.uint8)


def _pad_to_multiple(data: np.ndarray, multiple: int):
    pad_widths = []
    for s in data.shape:
        remainder = s % multiple
        if remainder == 0:
            pad_widths.append((0, 0))
        else:
            diff = multiple - remainder
            pad_widths.append((diff // 2, diff - diff // 2))
    pad_value = float(data.min())
    return (
        np.pad(data, pad_widths, mode="constant", constant_values=pad_value),
        pad_widths,
    )


def _unpad(data: np.ndarray, pad_widths: list):
    slices = tuple(
        slice(p[0], -p[1] if p[1] != 0 else None) for p in pad_widths
    )
    return data[slices]
