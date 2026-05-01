import pytest

from backend.workers.steps.step_config import (
    DicomToNiftiStepConfig,
    SegmentNiftiStepConfig,
)


def test_segment_config_rejects_unknown_keys():
    with pytest.raises(ValueError, match="Unknown segment"):
        SegmentNiftiStepConfig.from_mapping({"unknown": 1})


def test_segment_config_parses_threshold_pad():
    c = SegmentNiftiStepConfig.from_mapping({"threshold": 0.25, "pad_multiple": 8})
    assert c.threshold == 0.25
    assert c.pad_multiple == 8


def test_dicom_config_rejects_unknown_keys():
    with pytest.raises(ValueError, match="Unknown dicom"):
        DicomToNiftiStepConfig.from_mapping({"extra": True})

