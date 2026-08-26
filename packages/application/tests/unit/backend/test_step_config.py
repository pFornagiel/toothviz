import pytest

from backend.workers.steps.configs import (
    DicomToNiftiStepConfig,
)


def test_dicom_config_rejects_unknown_keys():
    with pytest.raises(ValueError, match="Unknown dicom"):
        DicomToNiftiStepConfig.from_mapping({"extra": True})

