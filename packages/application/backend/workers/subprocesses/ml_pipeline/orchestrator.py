import logging
import json
from pathlib import Path
from typing import Any

import nibabel as nib
import numpy as np

from .core import InferenceContext, TransformRegistry, PredictorRegistry
from . import transforms  # noqa: F401
from . import predictors  # noqa: F401

logger = logging.getLogger(__name__)


def run_pipeline(
    input_nifti_path: str,
    out_dir: str,
    config: dict[str, Any],
    model_session: Any,
    progress_queue: Any = None,
) -> str:
    """Run modular ML inference pipeline driven by a JSON-like config.
    
    Returns the path to the saved mask.
    """
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

    ctx = InferenceContext.from_nifti(image_data, spacing)

    # 1. Preprocessing
    preprocessing_steps = config.get("preprocessing", [])
    logger.info(f"Running {len(preprocessing_steps)} preprocessing steps")
    for step_cfg in preprocessing_steps:
        name = step_cfg["name"]
        params = {k: v for k, v in step_cfg.items() if k != "name"}
        logger.info(f"Preprocessing step: {name}")
        transform = TransformRegistry.get(name)()
        transform.forward(ctx, **params)

    # 2. Prediction
    prediction_cfg = config.get("prediction", {})
    strategy_name = prediction_cfg.get("strategy", "sliding_window_3d")
    strategy_params = prediction_cfg.get("params", {})
    logger.info(f"Running prediction with strategy: {strategy_name}")
    
    predictor = PredictorRegistry.get(strategy_name)()
    ctx.data = predictor.predict(model_session, ctx, progress_queue, **strategy_params)

    # 3. Postprocessing
    postprocessing_steps = config.get("postprocessing", [])
    logger.info(f"Running {len(postprocessing_steps)} postprocessing steps")
    for step_cfg in postprocessing_steps:
        name = step_cfg["name"]
        params = {k: v for k, v in step_cfg.items() if k != "name"}
        logger.info(f"Postprocessing step: {name}")
        transform = TransformRegistry.get(name)()
        transform.forward(ctx, **params)

    # Convert mask back from SimpleITK (Z, Y, X) to nibabel (X, Y, Z)
    # The mask might have a batch/channel dim if Argmax wasn't run, but assuming it was run:
    mask = ctx.data
    if mask.ndim == 4 and mask.shape[0] == 1:
        mask = mask[0]  # strip channel dim
        
    mask = np.transpose(mask, (2, 1, 0))
    
    mask_img = nib.Nifti1Image(mask.astype(np.uint8), affine=img.affine)
    mask_img.header.set_data_dtype(np.uint8)

    output_path = out / "segmentation_mask.nii.gz"
    logger.info(f"Saving final segmentation mask to {output_path}")
    nib.save(mask_img, str(output_path))

    return str(output_path)
