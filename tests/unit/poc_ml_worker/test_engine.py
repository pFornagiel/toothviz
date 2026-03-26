"""
Unit tests for ML inference engine.

Tests core engine functionality:
- predict() with threshold-based binarization
- run_inference() context manager and cleanup
"""

import numpy as np
import nibabel as nib
import pytest
from pathlib import Path

from poc_ml_worker.engine import run_inference

def test_run_inference_creates_and_cleans_file(tmp_path):
    """Test run_inference creates temporary file and cleans it up."""
    # Create input NIfTI
    image_data = np.random.rand(3, 3, 3).astype(np.float32)
    img = nib.Nifti1Image(image_data, np.eye(4))
    input_path = str(tmp_path / "input.nii.gz")
    nib.save(img, input_path)

    output_path = None
    with run_inference(input_path) as out_path:
        output_path = out_path
        assert Path(output_path).exists()
        assert output_path.endswith(".nii.gz")

    # File should be cleaned up
    assert not Path(output_path).exists()

def test_run_inference_handles_missing_file():
    """Test run_inference raises on missing input file."""
    with pytest.raises(Exception):
        with run_inference("/nonexistent/file.nii.gz"):
            pass
