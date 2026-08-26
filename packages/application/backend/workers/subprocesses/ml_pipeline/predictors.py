import logging
from typing import Any
import numpy as np
from scipy.ndimage import gaussian_filter

from .core import BasePredictor, InferenceContext, PredictorRegistry

logger = logging.getLogger(__name__)


def _compute_gaussian_map(patch_size: tuple[int, int, int]) -> np.ndarray:
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
