import logging
import nibabel as nib
import numpy as np
from nibabel.processing import resample_from_to, resample_to_output
from scipy.ndimage import zoom, binary_fill_holes

from .core import BaseTransform, InferenceContext, TransformRegistry

logger = logging.getLogger(__name__)


@TransformRegistry.register("CropToNonZero")
class CropToNonZero(BaseTransform):
    def forward(self, ctx: InferenceContext, **kwargs) -> None:
        data = ctx.data
        
        # Create mask where data is non-zero
        nonzero_mask = data[0] != 0
        for c in range(1, data.shape[0]):
            nonzero_mask |= data[c] != 0
        
        nonzero_mask = binary_fill_holes(nonzero_mask)
        coords = np.argwhere(nonzero_mask)
        
        if len(coords) == 0:
            ctx.history["CropToNonZero"] = None
            return

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

        ctx.data = data[:, x_min:x_max, y_min:y_max, z_min:z_max]
        ctx.history["CropToNonZero"] = bbox


@TransformRegistry.register("NormalizeCT")
class NormalizeCT(BaseTransform):
    def forward(self, ctx: InferenceContext, clip_min: float, clip_max: float, 
                z_score: bool = True, intensity_mean: float = 0.0, intensity_std: float = 1.0, **kwargs) -> None:
        data = np.clip(ctx.data, clip_min, clip_max)
        
        if z_score:
            data = (data - intensity_mean) / (intensity_std + 1e-8)
        else:
            data = (data - clip_min) / (clip_max - clip_min)

        ctx.data = data.astype(np.float32)


@TransformRegistry.register("Resample")
class Resample(BaseTransform):
    def forward(self, ctx: InferenceContext, target_spacing: list[float], **kwargs) -> None:
        target_spacing_arr = np.array(target_spacing)
        zoom_factors = ctx.current_spacing / target_spacing_arr

        new_shape = tuple([
            int(np.round(ctx.data.shape[i + 1] * zoom_factors[i]))
            for i in range(3)
        ])

        data_resampled = np.zeros((ctx.data.shape[0], *new_shape), dtype=np.float32)
        for c in range(ctx.data.shape[0]):
            data_resampled[c] = zoom(ctx.data[c], zoom_factors, order=3)

        ctx.history["Resample_original_shape"] = ctx.data.shape
        ctx.history["Resample_original_spacing"] = ctx.current_spacing
        
        ctx.data = data_resampled
        ctx.current_spacing = target_spacing_arr


@TransformRegistry.register("PadToSize")
class PadToSize(BaseTransform):
    def forward(self, ctx: InferenceContext, min_size: list[int], pad_value: float | None = None,
                **kwargs) -> None:
        """Pads with ``pad_value``, or with the volume minimum when it is not given."""
        shape_before_pad = ctx.data.shape
        
        target_shape = tuple([
            max(s, p) for s, p in zip(shape_before_pad[1:], min_size)
        ])

        pad_widths = [(0, 0)]
        for curr, targ in zip(shape_before_pad[1:], target_shape):
            pad = targ - curr
            pad_left = pad // 2
            pad_right = pad - pad_left
            pad_widths.append((pad_left, pad_right))

        if pad_value is None:
            pad_value = float(ctx.data.min())
        ctx.data = np.pad(ctx.data, pad_widths, mode='constant', constant_values=pad_value)

        slicer_revert = [slice(None)]
        for curr_dim_size, pw in zip(shape_before_pad[1:], pad_widths[1:]):
            start = pw[0]
            end = start + curr_dim_size
            slicer_revert.append(slice(start, end))

        ctx.history["PadToSize_slicer"] = tuple(slicer_revert)


@TransformRegistry.register("ReversePad")
class ReversePad(BaseTransform):
    def forward(self, ctx: InferenceContext, **kwargs) -> None:
        if "PadToSize_slicer" in ctx.history:
            ctx.data = ctx.data[ctx.history["PadToSize_slicer"]]


@TransformRegistry.register("ReverseResample")
class ReverseResample(BaseTransform):
    def forward(self, ctx: InferenceContext, order: int = 1, **kwargs) -> None:
        if "Resample_original_shape" not in ctx.history:
            return
            
        target_shape = ctx.history["Resample_original_shape"][1:] # spatial shape only
        current_shape = np.array(ctx.data.shape[1:])
        exact_zoom = np.array(target_shape) / current_shape

        output = np.zeros((ctx.data.shape[0], *target_shape), dtype=np.float32)

        for c in range(ctx.data.shape[0]):
            resampled_channel = zoom(ctx.data[c], exact_zoom, order=order)
            slices = tuple(slice(0, min(t, r)) for t, r in zip(target_shape, resampled_channel.shape))
            output[c][slices] = resampled_channel[slices]

        ctx.data = output
        ctx.current_spacing = ctx.history["Resample_original_spacing"]


@TransformRegistry.register("ReverseCrop")
class ReverseCrop(BaseTransform):
    def forward(self, ctx: InferenceContext, **kwargs) -> None:
        bbox = ctx.history.get("CropToNonZero")
        if not bbox:
            return

        # Use the original shape from context, but keep current number of channels (classes)
        original_shape = ctx.original_shape[1:]
        output = np.zeros((ctx.data.shape[0], *original_shape), dtype=np.float32)

        x_min, x_max = bbox['dim_0']
        y_min, y_max = bbox['dim_1']
        z_min, z_max = bbox['dim_2']

        output[:, x_min:x_max, y_min:y_max, z_min:z_max] = ctx.data
        ctx.data = output


@TransformRegistry.register("Argmax")
class Argmax(BaseTransform):
    def forward(self, ctx: InferenceContext, **kwargs) -> None:
        # Convert logits (C, X, Y, Z) to mask (X, Y, Z) then add dummy channel (1, X, Y, Z)
        # to remain consistent with context data shape expectations, or just keep as 3D inside 4D.
        mask = np.argmax(ctx.data, axis=0).astype(np.uint8)
        ctx.data = mask[np.newaxis, ...]



# Affine-aware grid transforms. They work on single-channel data (1, Z, Y, X) and keep
# ``ctx.affine`` in sync, so a scan in any orientation can be brought onto the grid the
# model was trained on and the result mapped back onto the input scan.

def _to_nifti(ctx: InferenceContext) -> nib.Nifti1Image:
    """Context data (1, Z, Y, X) as a nibabel image (X, Y, Z) on ``ctx.affine``."""
    if ctx.data.shape[0] != 1:
        raise ValueError(f"grid transforms expect a single channel, got shape {ctx.data.shape}")
    return nib.Nifti1Image(ctx.data[0].transpose(2, 1, 0), ctx.affine)


def _from_nifti(ctx: InferenceContext, img: nib.Nifti1Image) -> None:
    ctx.data = np.asarray(img.dataobj).transpose(2, 1, 0)[np.newaxis]
    ctx.affine = img.affine
    ctx.current_spacing = np.array(img.header.get_zooms()[:3])[::-1]


@TransformRegistry.register("ResampleToVoxelSize")
class ResampleToVoxelSize(BaseTransform):
    """Resample to isotropic ``voxel_size`` mm voxels; skipped when the scan has them already."""
    def forward(self, ctx: InferenceContext, voxel_size: float, order: int = 1, **kwargs) -> None:
        if np.allclose(ctx.current_spacing, voxel_size, atol=1e-3):
            return
        img = resample_to_output(_to_nifti(ctx), voxel_sizes=(voxel_size,) * 3, order=order)
        _from_nifti(ctx, img)


@TransformRegistry.register("Reorient")
class Reorient(BaseTransform):
    """Reorient to the model's axis codes (nibabel convention, e.g. ["R", "P", "I"])."""
    def forward(self, ctx: InferenceContext, axcodes: list[str], **kwargs) -> None:
        img = _to_nifti(ctx)
        current = nib.orientations.io_orientation(img.affine)
        target = nib.orientations.axcodes2ornt(tuple(axcodes))
        _from_nifti(ctx, img.as_reoriented(nib.orientations.ornt_transform(current, target)))


@TransformRegistry.register("ResampleToInputGrid")
class ResampleToInputGrid(BaseTransform):
    """Map a label volume back onto the input scan's grid; nearest neighbour keeps labels intact."""
    def forward(self, ctx: InferenceContext, **kwargs) -> None:
        input_grid = (ctx.original_shape[1:][::-1], ctx.original_affine)
        _from_nifti(ctx, resample_from_to(_to_nifti(ctx), input_grid, order=0))


# 2.5D models: each axial slice is a 2D image whose channels are the slice and its neighbours.

@TransformRegistry.register("SliceContext25D")
class SliceContext25D(BaseTransform):
    """(1, Z, Y, X) -> (3, Z, Y, X): slices z - offset, z, z + offset (clamped at the edges)."""
    def forward(self, ctx: InferenceContext, offset: int, **kwargs) -> None:
        volume = ctx.data[0]
        z = np.arange(volume.shape[0])
        last = volume.shape[0] - 1
        below = volume[np.clip(z - offset, 0, last)]
        above = volume[np.clip(z + offset, 0, last)]
        ctx.data = np.stack([below, volume, above]).astype(np.float32)


@TransformRegistry.register("ZScorePerChannel")
class ZScorePerChannel(BaseTransform):
    """Normalise every channel with its own mean and std (statistics of this scan)."""
    def forward(self, ctx: InferenceContext, **kwargs) -> None:
        ctx.data = ctx.data.astype(np.float32, copy=False)
        for c in range(ctx.data.shape[0]):
            channel = ctx.data[c]
            ctx.data[c] = (channel - channel.mean()) / max(channel.std(), 1e-8)


# Label postprocessing (data is a (1, Z, Y, X) label volume).

@TransformRegistry.register("DropLabelsAbove")
class DropLabelsAbove(BaseTransform):
    """Set labels above ``max_label`` (helper classes the app does not show) to background."""
    def forward(self, ctx: InferenceContext, max_label: int, **kwargs) -> None:
        ctx.data[ctx.data > max_label] = 0


@TransformRegistry.register("RemoveSmallLabels")
class RemoveSmallLabels(BaseTransform):
    """Set every label whose total volume is below ``min_volume_mm3`` to background."""
    def forward(self, ctx: InferenceContext, min_volume_mm3: float, **kwargs) -> None:
        min_voxels = min_volume_mm3 / float(np.prod(ctx.current_spacing))
        counts = np.bincount(ctx.data.ravel())
        small = [label for label, count in enumerate(counts) if label > 0 and 0 < count < min_voxels]
        if small:
            ctx.data[np.isin(ctx.data, small)] = 0
