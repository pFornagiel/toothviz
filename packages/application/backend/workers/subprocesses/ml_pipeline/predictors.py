import itertools
import logging
from typing import Any
import numpy as np
from scipy.ndimage import gaussian_filter

from .core import BasePredictor, InferenceContext, PredictorRegistry

logger = logging.getLogger(__name__)


def _compute_gaussian_map(patch_size: tuple[int, ...]) -> np.ndarray:
    tmp = np.zeros(patch_size)
    center = tuple([s // 2 for s in patch_size])
    tmp[center] = 1

    sigmas = [s / 8.0 for s in patch_size]
    gmap = gaussian_filter(tmp, sigmas)
    gmap = gmap / gmap.max()
    gmap[gmap == 0] = 1e-6

    return gmap


def _compute_sliding_window_slices(
    image_shape: tuple[int, ...],
    patch_size: tuple[int, ...],
    tile_step_size: float = 0.5,
) -> list[tuple[slice, ...]]:
    """Overlapping patch windows covering ``image_shape``, for any number of dimensions."""
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

    return [
        tuple(slice(start, start + patch) for start, patch in zip(starts, patch_size))
        for starts in itertools.product(*steps)
    ]


@PredictorRegistry.register("sliding_window_3d")
class SlidingWindow3DPredictor(BasePredictor):
    def predict(self, model_session: Any, ctx: InferenceContext, progress_queue: Any = None, 
                patch_size: list[int] = [256, 256, 256], tile_step_size: float = 0.5, **kwargs) -> np.ndarray:
        
        image_data = ctx.data
        spatial_shape = image_data.shape[1:]
        patch_size_tuple = tuple(patch_size)
        
        slices = _compute_sliding_window_slices(spatial_shape, patch_size_tuple, tile_step_size)
        gaussian_map = _compute_gaussian_map(patch_size_tuple)

        input_name = model_session.get_inputs()[0].name
        dummy_input = np.zeros((1, image_data.shape[0], *patch_size_tuple), dtype=np.float32)
        dummy_output = model_session.run(None, {input_name: dummy_input})[0]
        num_classes = dummy_output.shape[1] if dummy_output.ndim in (4, 5) else 1

        output = np.zeros((num_classes, *spatial_shape), dtype=np.float32)
        counts = np.zeros(spatial_shape, dtype=np.float32)

        total_patches = max(1, len(slices))
        logger.info(f"Generated {total_patches} patches for sliding window inference.")

        for i, patch_slice in enumerate(slices):
            if progress_queue is not None:
                try:
                    progress_queue.put((i + 1, total_patches))
                except Exception:
                    pass
                    
            patch = image_data[:, patch_slice[0], patch_slice[1], patch_slice[2]]
            patch = np.expand_dims(patch, 0)

            pred = model_session.run(None, {input_name: patch})[0]
            pred = np.squeeze(pred, axis=0)

            weighted_pred = pred * gaussian_map[np.newaxis, ...]

            output[:, patch_slice[0], patch_slice[1], patch_slice[2]] += weighted_pred
            counts[patch_slice[0], patch_slice[1], patch_slice[2]] += gaussian_map

        output = output / counts[np.newaxis, ...]
        return output


@PredictorRegistry.register("sliding_window_2d")
class SlidingWindow2DPredictor(BasePredictor):
    """
    For 2.5D models: (C, Z, Y, X) input -> (1, Z, Y, X) uint8 labels.

    Every axial slice is a 2D image of C channels; ``batch_size`` slices go through the
    model at a time. Slices larger than the patch are covered by overlapping tiles whose
    logits are Gaussian-weighted and summed. The argmax is taken per batch, so logits are
    never held for the whole volume.
    """
    def predict(self, model_session: Any, ctx: InferenceContext, progress_queue: Any = None,
                patch_size: list[int] = [384, 384], tile_step_size: float = 0.5,
                batch_size: int = 8, **kwargs) -> np.ndarray:
        data = ctx.data
        _, depth, height, width = data.shape

        # Size of the slice (WxH window) passed to the model as input
        patch_size_tuple = tuple(patch_size)

        # Compute sliding window patches and Gaussian map for the inference
        tiles = _compute_sliding_window_slices((height, width), patch_size_tuple, tile_step_size)
        gaussian_map = _compute_gaussian_map(patch_size_tuple).astype(np.float32)
        # Get the input name from the ONNX runtime session, to later pass to the model
        input_name = model_session.get_inputs()[0].name

        # We infer in batches, not one by one
        batch_starts = range(0, depth, batch_size)
        logger.info(f"Predicting {depth} slices in {len(batch_starts)} batches of {len(tiles)} tiles.")

        labels = np.empty((depth, height, width), dtype=np.uint8)

        # Iterate over the batches
        for i, z0 in enumerate(batch_starts):
            # The batch is the array (Batches, Channels, Height, Width)
            batch = data[:, z0:z0 + batch_size].transpose(1, 0, 2, 3)  # (B, C, Y, X)
            logits = None
            # Iterate over the patches (WxH windows) we pass to the model - we are not passing 
            # the entire slice at once if it is too large, given the memory constraints
            for tile_y, tile_x in tiles:
                # Inference patch
                window = (slice(None), slice(None), tile_y, tile_x)
                tile = np.ascontiguousarray(batch[window])
                # Run the inference using ONNX runtime
                outputs = model_session.run(None, {input_name: tile})
                out = outputs[0] # (B, num_classes, patch_h, patch_w)
                weighted_out = out * gaussian_map
                if logits is None:
                    logits = np.zeros((weighted_out.shape[0], weighted_out.shape[1], height, width), dtype=np.float32)
                # Add up the logits from ALL the patches, then take the argmax. 
                logits[window] += weighted_out
            labels[z0:z0 + batch_size] = logits.argmax(axis=1)

            if progress_queue is not None:
                try:
                    progress_queue.put((i + 1, len(batch_starts)))
                except Exception:
                    pass

        return labels[np.newaxis]
