import pytest
from pydantic import ValidationError as PydanticValidationError

from backend.schemas import (
    BeginUploadRequest,
    FinalizeRequest,
    PipelineRequestItem,
    StudyResponse,
)


def test_begin_upload_valid_kinds():
    for kind in ("dicom_zip", "nifti_raw", "nifti_mask"):
        req = BeginUploadRequest(kind=kind, filename="test.nii")
        assert req.kind == kind


def test_begin_upload_invalid_kind():
    with pytest.raises(PydanticValidationError):
        BeginUploadRequest(kind="unknown_kind", filename="test.nii")


def test_pipeline_request_valid_name():
    item = PipelineRequestItem(name="segment_nifti")
    assert item.name == "segment_nifti"
    assert item.config == {}


def test_pipeline_request_invalid_name():
    with pytest.raises(PydanticValidationError):
        PipelineRequestItem(name="unknown_step")


def test_finalize_request_defaults():
    req = FinalizeRequest()
    assert req.pipelines == []
    assert req.expected_sha256 is None


def test_study_response_serialization():
    from datetime import datetime, timezone
    resp = StudyResponse(
        id="s1", name="Test", external_id=None, status="created",
        created_at=datetime.now(timezone.utc), updated_at=None, meta={},
    )
    data = resp.model_dump()
    assert data["id"] == "s1"
    assert data["name"] == "Test"
