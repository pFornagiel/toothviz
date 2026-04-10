"""
Unit tests for ML inference engine.

Tests core engine functionality:
- predict() with ONNX model inference
- run_inference() context manager and cleanup
- create_mask_file() integration
"""

import numpy as np
import nibabel as nib
import pytest
from pathlib import Path
from unittest.mock import Mock

from poc_ml_worker.engine import predict, run_inference, create_mask_file


def create_mock_model():
    """Create a mock ONNX InferenceSession."""
    mock_model = Mock()
    mock_model.get_inputs.return_value = [Mock(name="input")]
    
    # Mock predict: threshold-binarize at 0.5
    def run_side_effect(_, inputs_dict):
        for value in inputs_dict.values():
            input_data = value
            break
        # Remove batch and channel dims, apply threshold
        output = (input_data > 0.5).astype(np.float32)
        return [output]
    
    mock_model.run.side_effect = run_side_effect
    return mock_model


def test_predict_model_inference():
    """Test predict runs model inference and binarizes output."""
    image_data = np.array([0.3, 0.5, 0.6, 0.9], dtype=np.float32).reshape(2, 2)
    mock_model = create_mock_model()
    
    mask = predict(mock_model, image_data)
    
    assert mask.dtype == np.uint8
    assert np.all((mask == 0) | (mask == 1))
    assert mock_model.run.called
    assert mock_model.get_inputs.called


def test_predict_threshold_at_05():
    """Test predict thresholds output at 0.5."""
    image_data = np.array([0.4, 0.5, 0.51], dtype=np.float32).reshape(1, 3)
    mock_model = create_mock_model()
    
    mask = predict(mock_model, image_data)
    
    expected = np.array([0, 0, 1], dtype=np.uint8).reshape(1, 3)
    np.testing.assert_array_equal(mask, expected)


def test_create_mask_file_with_model(tmp_path):
    """Test create_mask_file with ONNX model."""
    # Create input NIfTI
    image_data = np.array([0.3, 0.7, 0.4, 0.8], dtype=np.float32).reshape(2, 2, 1)
    img = nib.Nifti1Image(image_data, np.eye(4))
    input_path = str(tmp_path / "input.nii.gz")
    nib.save(img, input_path)
    
    output_path = str(tmp_path / "output.nii.gz")
    mock_model = create_mock_model()
    
    mask = create_mask_file(input_path, output_path, mock_model)
    
    assert Path(output_path).exists()
    assert mask.dtype == np.uint8
    
    # Load and verify output
    output_img = nib.load(output_path)
    output_data = output_img.get_fdata()
    
    expected = np.array([[0, 1], [0, 1]], dtype=np.uint8).reshape(2, 2, 1)
    np.testing.assert_array_equal(output_data, expected)


def test_run_inference_creates_and_cleans_file(tmp_path):
    """Test run_inference creates temporary file and cleans it up."""
    # Create input NIfTI
    image_data = np.random.rand(2, 2, 2).astype(np.float32)
    img = nib.Nifti1Image(image_data, np.eye(4))
    input_path = str(tmp_path / "input.nii.gz")
    nib.save(img, input_path)

    mock_model = create_mock_model()
    output_path = None
    
    with run_inference(input_path, mock_model) as out_path:
        output_path = out_path
        assert Path(output_path).exists()
        assert output_path.endswith(".nii.gz")

    assert not Path(output_path).exists()


def test_run_inference_handles_missing_file():
    """Test run_inference raises on missing input file."""
    mock_model = create_mock_model()
    
    with pytest.raises(Exception):
        with run_inference("/nonexistent/file.nii.gz", mock_model):
            pass
