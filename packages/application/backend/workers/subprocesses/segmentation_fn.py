"""Pure compute: ONNX segmentation inference on a NIfTI file.

Runs in a subprocess via WorkerPool. Receives and returns plain strings only.
The model is loaded once per worker process via _init_segmentation().

Preprocessing flow:
  1. Load NIFTI
  2. Crop to non-zero region
  3. Resample to target spacing
  4. Normalize intensities (CT-specific)
  5. Pad to patch size
  6. Sliding window inference with Gaussian blending
  7. Reverse all operations
  8. Save NIFTI
"""

from __future__ import annotations

import logging
from pathlib import Path

import nibabel as nib
import numpy as np
from scipy.ndimage import zoom, gaussian_filter, binary_fill_holes

from backend.workers.subprocesses._onnx_helpers import load_onnx_model
from dataclasses import dataclass
from backend.workers.steps.configs import SegmentNiftiStepConfig

logger = logging.getLogger(__name__)


_model = None


def _init_segmentation(model_path: str, execution_providers: tuple[str, ...]) -> None:
    """Process-level initializer — called once per worker process."""
    global _model

    from backend.logging import setup_logging
    setup_logging("segmentation_worker")

    providers = list(execution_providers) if execution_providers else None
    _model = load_onnx_model(model_path, providers=providers)


def run_segmentation(
    input_nifti_path: str,
    out_dir: str,
    config: SegmentNiftiStepConfig
    ) -> str:
    """Run segmentation inference with nnUNet v2-style preprocessing.
    
    Returns the mask path (str).
    """
    if _model is None:
        raise RuntimeError(
            "segmentation model not initialized — call _init_segmentation first"
        )

    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)

    logger.info(f"Loading NIfTI image from {input_nifti_path}")
    img = nib.load(input_nifti_path)
    image_data = np.asarray(img.get_fdata(dtype=np.float32))

    if image_data.ndim == 4 and image_data.shape[-1] == 1:
        image_data = image_data[..., 0]
    if image_data.ndim != 3:
        raise ValueError(
            f"segmentation expects a 3D volume; got shape {image_data.shape!r}"
        )

    # Convert nibabel (X, Y, Z) to SimpleITK (Z, Y, X) space, which nnUNet expects
    image_data = np.transpose(image_data, (2, 1, 0))
    spacing = np.array(img.header.get_zooms()[:3])[::-1]

    mask = _predict_with_preprocessing_and_postprocessing(
        image_data, spacing, config=config
    )
    
    # Convert mask back from SimpleITK (Z, Y, X) to nibabel (X, Y, Z)
    mask = np.transpose(mask, (2, 1, 0))
    
    mask_img = nib.Nifti1Image(mask.astype(np.uint8), affine=img.affine)
    mask_img.header.set_data_dtype(np.uint8)

    output_path = out / "segmentation_mask.nii.gz"
    logger.info(f"Saving final segmentation mask to {output_path}")
    nib.save(mask_img, str(output_path))

    return str(output_path)


def _predict_with_preprocessing_and_postprocessing(
    image_data: np.ndarray,
    spacing: np.ndarray,
    *,
    config: SegmentNiftiStepConfig,
) -> np.ndarray:
    """Run preprocessing + inference + postprocessing with nnUNet v2 flow."""
    if _model is None:
        raise RuntimeError("segmentation model not initialized")

    # Store properties for reverse operations
    props = {}
    props['original_shape'] = image_data.shape
    props['original_spacing'] = spacing
    props['original_affine'] = None  # Not needed for reverse ops

    image_data = image_data[np.newaxis, ...]  # Now (1, X, Y, Z)

    logger.info("Cropping to non-zero region")
    image_data, bbox = _crop_to_nonzero(image_data)
    props['bbox'] = bbox
    props['shape_after_crop'] = image_data.shape

    logger.info("Normalizing CT intensities")
    image_data = _normalize_ct(image_data, config)

    target_spacing = np.array(config.target_spacing)
    logger.info(f"Resampling to target spacing: {target_spacing}")
    image_data, new_spacing = _resample(image_data, spacing, target_spacing)
    props['resampled_spacing'] = new_spacing
    props['shape_after_resample'] = image_data.shape

    patch_size = config.patch_size
    logger.info(f"Padding image to match minimum patch size: {patch_size}")
    image_data, slicer_revert_pad = _pad_to_patch_size(image_data, patch_size)
    props['slicer_revert_pad'] = slicer_revert_pad
    props['shape_after_pad'] = image_data.shape

    logger.info("Running sliding window inference")
    logits = _predict_sliding_window(
        image_data, 
        patch_size=patch_size, 
        tile_step_size=config.tile_step_size
    )
    logits = logits[props['slicer_revert_pad']]

    logger.info("Reversing preprocessing operations (resample, crop)")
    logits = _reverse_resample(
        logits, 
        props['shape_after_crop'][1:],
        props['resampled_spacing'],
        spacing
    )

    logits = _reverse_crop(logits, bbox, props['original_shape'])

    mask = _logits_to_segmentation(logits)

    return mask

# ===== nnUNet v2-STYLE PREPROCESSING FUNCTIONS =====

def _crop_to_nonzero(data: np.ndarray) -> tuple[np.ndarray, dict]:
    """Crop to bounding box of non-zero voxels.
    
    Args:
        data: (C, X, Y, Z) array
    
    Returns:
        Tuple of (cropped_data, bbox_dict)
    """
    # Create mask where data is non-zero
    nonzero_mask = data[0] != 0
    for c in range(1, data.shape[0]):
        nonzero_mask |= data[c] != 0
    
    # Fill holes in the mask as done in nnUNet v2 create_nonzero_mask
    nonzero_mask = binary_fill_holes(nonzero_mask)

    coords = np.argwhere(nonzero_mask)
    if len(coords) == 0:
        # Entire image is zero
        return data, {}

    mins = coords.min(axis=0)
    maxs = coords.max(axis=0) + 1

    bbox = {
        'dim_0': (int(mins[0]), int(maxs[0])),
        'dim_1': (int(mins[1]), int(maxs[1])),
        'dim_2': (int(mins[2]), int(maxs[2])),
    }

    x_min, x_max = bbox['dim_0']
    y_min, y_max = bbox['dim_1']
    z_min, z_max = bbox['dim_2']

    data_cropped = data[:, x_min:x_max, y_min:y_max, z_min:z_max]
    return data_cropped, bbox


def _resample(
    data: np.ndarray, 
    original_spacing: np.ndarray, 
    target_spacing: np.ndarray
) -> tuple[np.ndarray, np.ndarray]:
    """Resample to target spacing using cubic interpolation.
    
    Args:
        data: (C, X, Y, Z) array
        original_spacing: Original voxel spacing in mm
        target_spacing: Target voxel spacing in mm
    
    Returns:
        Tuple of (resampled_data, new_spacing)
    """
    zoom_factors = original_spacing / target_spacing

    new_shape = tuple([
        int(np.round(data.shape[i + 1] * zoom_factors[i]))
        for i in range(3)
    ])

    data_resampled = np.zeros((data.shape[0], *new_shape), dtype=np.float32)
    for c in range(data.shape[0]):
        data_resampled[c] = zoom(data[c], zoom_factors, order=3)

    return data_resampled, target_spacing


def _normalize_ct(data: np.ndarray, config: SegmentNiftiStepConfig) -> np.ndarray:
    """Normalize CT intensities using HU clipping and optionally Z-score scaling.
    
    Args:
        data: (C, X, Y, Z) array with HU values
        config: SegmentNiftiStepConfig object with normalization parameters
    
    Returns:
        Normalized data
    """
    data = np.clip(data, config.clip_min, config.clip_max)
    
    if config.apply_z_score:
        data = (data - config.intensity_mean) / (config.intensity_std + 1e-8)
    else:
        # Fallback to standard [0, 1] scaling
        data = (data - config.clip_min) / (config.clip_max - config.clip_min)

    return data.astype(np.float32)


def _pad_to_patch_size(
    data: np.ndarray, 
    patch_size: tuple[int, int, int]
) -> tuple[np.ndarray, tuple]:
    """Pad to minimum of patch_size (nnUNet v2 style).
    
    Args:
        data: (C, X, Y, Z) array
        patch_size: e.g. (256, 256, 256)
    
    Returns:
        Tuple of (padded_data, slicer_to_remove_padding)
    """
    # Pad to ensure every dimension is at least as large as patch_size
    target_shape = tuple([
        max(s, p)
        for s, p in zip(data.shape[1:], patch_size)
    ])

    pad_widths = [(0, 0)]  # No padding for channels
    for curr, targ in zip(data.shape[1:], target_shape):
        pad = targ - curr
        # Symmetric padding
        pad_left = pad // 2
        pad_right = pad - pad_left
        pad_widths.append((pad_left, pad_right))

    pad_value = float(data.min())
    data_padded = np.pad(data, pad_widths, mode='constant', constant_values=pad_value)

    # Slicer to remove padding and extract original shape
    slicer_revert = [slice(None)]
    for curr_dim_size, pw in zip(data.shape[1:], pad_widths[1:]):
        start = pw[0]
        end = start + curr_dim_size
        slicer_revert.append(slice(start, end))

    return data_padded, tuple(slicer_revert)


def _compute_gaussian_map(patch_size: tuple[int, int, int]) -> np.ndarray:
    """Create Gaussian importance map for blending.
    
    Args:
        patch_size: e.g. (256, 256, 256)
    
    Returns:
        Gaussian map of patch_size with values in [eps, 1]
    """
    tmp = np.zeros(patch_size)
    center = tuple([s // 2 for s in patch_size])
    tmp[center] = 1

    sigmas = [s / 8.0 for s in patch_size]
    gmap = gaussian_filter(tmp, sigmas)
    gmap = gmap / gmap.max()
    gmap[gmap == 0] = 1e-6

    return gmap


def _compute_sliding_window_slices(
    image_shape: tuple[int, int, int],
    patch_size: tuple[int, int, int],
    tile_step_size: float = 0.5,
) -> list[tuple[slice, slice, slice]]:
    """Compute sliding window patch slices.
    
    Args:
        image_shape: (X, Y, Z) shape of padded image
        patch_size: e.g. (256, 256, 256)
        tile_step_size: 0.5 for 50% overlap
    
    Returns:
        List of (slice_x, slice_y, slice_z) for each patch
    """
    target_step_sizes = [int(p * tile_step_size) for p in patch_size]

    steps = []
    for dim_size, target_step, patch in zip(image_shape, target_step_sizes, patch_size):
        max_step_value = dim_size - patch
        num_steps = int(np.ceil(max_step_value / target_step)) + 1

        if num_steps > 1:
            actual_step = max_step_value / (num_steps - 1)
        else:
            actual_step = 0

        dim_steps = [int(np.round(actual_step * i)) for i in range(num_steps)]
        dim_steps = [min(s, max_step_value) for s in dim_steps]
        steps.append(dim_steps)

    # Generate all combinations
    slices = []
    for x in steps[0]:
        for y in steps[1]:
            for z in steps[2]:
                slices.append((
                    slice(x, x + patch_size[0]),
                    slice(y, y + patch_size[1]),
                    slice(z, z + patch_size[2]),
                ))

    return slices


def _predict_sliding_window(
    image_data: np.ndarray,
    patch_size: tuple[int, int, int] = (256, 256, 256),
    tile_step_size: float = 0.5,
) -> np.ndarray:
    """Run inference with sliding window and Gaussian blending.
    
    Args:
        image_data: (C, X, Y, Z) preprocessed image
        patch_size: e.g. (256, 256, 256)
        tile_step_size: 0.5 for 50% overlap
    
    Returns:
        Output logits (num_classes, X, Y, Z)
    """
    if _model is None:
        raise RuntimeError("segmentation model not initialized")

    spatial_shape = image_data.shape[1:]
    slices = _compute_sliding_window_slices(spatial_shape, patch_size, tile_step_size)
    gaussian_map = _compute_gaussian_map(patch_size)

    # Get model output channels
    input_name = _model.get_inputs()[0].name
    dummy_input = np.zeros((1, image_data.shape[0], *patch_size), dtype=np.float32)
    dummy_output = _model.run(None, {input_name: dummy_input})[0]
    num_classes = dummy_output.shape[1] if dummy_output.ndim in (4, 5) else 1

    # Preallocate output
    output = np.zeros((num_classes, *spatial_shape), dtype=np.float32)
    counts = np.zeros(spatial_shape, dtype=np.float32)

    # Process each patch
    logger.info(f"Generated {len(slices)} patches for sliding window inference.")
    for i, patch_slice in enumerate(slices):
        logger.info(f"Analyzing patch {i+1}/{len(slices)}: {patch_slice}")
        # Extract patch
        patch = image_data[:, patch_slice[0], patch_slice[1], patch_slice[2]]
        patch = np.expand_dims(patch, 0)  # Add batch dimension: (1, C, 256, 256, 256)

        # Network inference
        pred = _model.run(None, {input_name: patch})[0]  # (1, C, 256, 256, 256)
        pred = np.squeeze(pred, axis=0)  # Remove batch: (C, 256, 256, 256)

        # Apply Gaussian weighting
        weighted_pred = pred * gaussian_map[np.newaxis, ...]

        # Accumulate
        output[:, patch_slice[0], patch_slice[1], patch_slice[2]] += weighted_pred
        counts[patch_slice[0], patch_slice[1], patch_slice[2]] += gaussian_map

    # Normalize
    output = output / counts[np.newaxis, ...]

    return output


def _reverse_resample(
    logits: np.ndarray,
    cropped_shape: tuple[int, int, int],
    resampled_spacing: np.ndarray,
    original_spacing: np.ndarray,
) -> np.ndarray:
    """Reverse resampling back to original spacing."""
    # Calculate exact zoom factors to match cropped_shape exactly, avoiding broadcasting errors
    current_shape = np.array(logits.shape[1:])
    target_shape = np.array(cropped_shape)
    exact_zoom = target_shape / current_shape

    output = np.zeros((logits.shape[0], *cropped_shape), dtype=np.float32)


    for c in range(logits.shape[0]):
        logger.info(f"Re-sampling channel {c} (order=1)")
        # order=1 (linear) is much faster than order=3 (cubic) and sufficient for logits
        resampled_channel = zoom(logits[c], exact_zoom, order=1)
        
        # Handle potential rounding differences in scipy.ndimage.zoom
        slices = tuple(slice(0, min(t, r)) for t, r in zip(target_shape, resampled_channel.shape))
        output[c][slices] = resampled_channel[slices]

    return output


def _reverse_crop(
    logits: np.ndarray,
    bbox: dict,
    original_shape: tuple[int, int, int],
) -> np.ndarray:
    """Insert cropped logits back into full-size volume.
    
    Args:
        logits: (C, X, Y, Z) cropped logits
        bbox: Bounding box dict with 'dim_0', 'dim_1', 'dim_2'
        original_shape: Original shape (X, Y, Z)
    
    Returns:
        Logits at original_shape
    """
    if not bbox:
        return logits

    output = np.zeros((logits.shape[0], *original_shape), dtype=np.float32)

    x_min, x_max = bbox['dim_0']
    y_min, y_max = bbox['dim_1']
    z_min, z_max = bbox['dim_2']

    output[:, x_min:x_max, y_min:y_max, z_min:z_max] = logits

    return output


def _logits_to_segmentation(
    logits: np.ndarray) -> np.ndarray:
    """Convert raw logits to multi-class segmentation mask.
    
    Outputs class labels 0-32: 0=background, 1-32=individual teeth.
    
    Args:
        logits: (C, X, Y, Z) raw network output with 33 channels (one per class)    
    Returns:
        Segmentation mask (X, Y, Z) with values 0-32 indicating tooth class
    """
    mask = np.argmax(logits, axis=0).astype(np.uint8)

    return mask
