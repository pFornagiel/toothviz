"""
Unit tests for ML Worker.

Tests core ML worker functionality:
- Initialization with model
- Task orchestration with model inference
"""

from unittest.mock import Mock, patch
from pathlib import Path

from poc_ml_worker.ml_worker import MLWorker


def test_mlworker_initialization():
    """Test MLWorker initializes with model."""
    mock_session_factory = Mock()
    mock_storage = Mock()
    mock_storage.root = Path("/data")
    mock_model = Mock()

    worker = MLWorker(
        session_factory=mock_session_factory,
        storage=mock_storage,
        ml_model=mock_model
    )

    assert worker.session_factory == mock_session_factory
    assert worker.storage == mock_storage
    assert worker.ml_model == mock_model
    assert worker.poll_interval == 2


def test_orchestrate_task_success():
    """Test successful task orchestration with inference."""
    mock_db = Mock()
    mock_session_factory = Mock()
    mock_storage = Mock()
    mock_storage.root = Path("/data")
    mock_model = Mock()

    worker = MLWorker(
        session_factory=mock_session_factory,
        storage=mock_storage,
        ml_model=mock_model
    )

    # Setup task mock
    mock_task = Mock()
    mock_task.id = 1
    mock_task.study_id = "study_123"
    mock_task.file_id = "file_001"

    mock_stored_file = Mock()
    mock_stored_file.rel_path = Path("study_123/original/image.nii.gz")

    mock_result_file = Mock()
    mock_result_file.id = "result_001"

    mock_storage.get_file.return_value = mock_stored_file
    mock_storage.store_from_local_path.return_value = mock_result_file

    # Mock file existence and inference
    with patch('pathlib.Path.exists', return_value=True):
        with patch('poc_ml_worker.ml_worker.run_inference') as mock_run_inference:
            mock_run_inference.return_value.__enter__ = Mock(return_value="/tmp/output.nii.gz")
            mock_run_inference.return_value.__exit__ = Mock(return_value=False)

            worker.orchestrate_task(mock_db, mock_task)

    # Verify model was passed to run_inference
    assert mock_run_inference.called
    call_args = mock_run_inference.call_args
    assert call_args[0][1] == mock_model  # Second positional arg is model


def test_orchestrate_task_missing_input_file():
    """Test task handling when input file is missing."""
    mock_db = Mock()
    mock_session_factory = Mock()
    mock_storage = Mock()
    mock_storage.root = Path("/data")
    mock_model = Mock()

    worker = MLWorker(
        session_factory=mock_session_factory,
        storage=mock_storage,
        ml_model=mock_model
    )

    mock_task = Mock()
    mock_task.id = 1
    mock_task.study_id = "study_123"
    mock_task.file_id = "file_001"

    mock_stored_file = Mock()
    mock_stored_file.rel_path = Path("study_123/original/image.nii.gz")

    mock_storage.get_file.return_value = mock_stored_file

    # File doesn't exist
    with patch('pathlib.Path.exists', return_value=False):
        worker.orchestrate_task(mock_db, mock_task)

    # Should mark as failed
    assert mock_db.commit.called


def test_orchestrate_task_inference_exception():
    """Test task handling when inference raises exception."""
    mock_db = Mock()
    mock_session_factory = Mock()
    mock_storage = Mock()
    mock_storage.root = Path("/data")
    mock_model = Mock()

    worker = MLWorker(
        session_factory=mock_session_factory,
        storage=mock_storage,
        ml_model=mock_model
    )

    mock_task = Mock()
    mock_task.id = 1
    mock_task.study_id = "study_123"
    mock_task.file_id = "file_001"

    mock_stored_file = Mock()
    mock_stored_file.rel_path = Path("study_123/original/image.nii.gz")

    mock_storage.get_file.return_value = mock_stored_file

    with patch('pathlib.Path.exists', return_value=True):
        with patch('poc_ml_worker.ml_worker.run_inference') as mock_run_inference:
            mock_run_inference.side_effect = RuntimeError("Inference failed")

            worker.orchestrate_task(mock_db, mock_task)

    # Should handle gracefully and mark as failed
    assert mock_db.commit.called
