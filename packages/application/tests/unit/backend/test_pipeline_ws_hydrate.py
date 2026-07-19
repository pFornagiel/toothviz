"""DB hydrate for WebSocket reconnect catch-up frames."""

from backend.db.models import FileRecord, PipelineJob, Study
from backend.services.pipeline_ws_hydrate import build_pipeline_ws_hydrate


def _setup(db_session, status: str, steps=None, error=None):
    db_session.add(Study(id="s1", name="Study"))
    db_session.commit()
    db_session.add(
        FileRecord(
            id="vol",
            study_id="s1",
            kind="nifti_raw",
            display_name="vol.nii",
            blob_hash="a" * 64,
            size=10,
            viewer_purpose="viewer_volume",
        )
    )
    db_session.add(
        FileRecord(
            id="mask",
            study_id="s1",
            kind="segmentation_mask",
            display_name="mask.nii",
            blob_hash="b" * 64,
            size=10,
            viewer_purpose="viewer_overlay",
        )
    )
    db_session.commit()
    db_session.add(
        PipelineJob(
            id="j1",
            study_id="s1",
            source_file_id="vol",
            steps=steps or ["segment_nifti"],
            status=status,
            error=error,
        )
    )
    db_session.commit()


def test_hydrate_completed_includes_file_ids(db_session, session_factory):
    _setup(db_session, "completed")
    hydrate = build_pipeline_ws_hydrate(session_factory)
    payload = hydrate("j1")
    assert payload is not None
    assert payload["event"] == "pipeline_completed"
    assert payload["volume_file_id"] == "vol"
    assert payload["overlay_file_id"] == "mask"


def test_hydrate_failed(db_session, session_factory):
    _setup(db_session, "failed", error="boom")
    hydrate = build_pipeline_ws_hydrate(session_factory)
    payload = hydrate("j1")
    assert payload == {
        "event": "pipeline_failed",
        "job_id": "j1",
        "status": "failed",
        "error": "boom",
        "failed_step": None,
    }


def test_hydrate_running_emits_step_started(db_session, session_factory):
    _setup(db_session, "running", steps=["dicom_to_nifti", "segment_nifti"])
    hydrate = build_pipeline_ws_hydrate(session_factory)
    payload = hydrate("j1")
    assert payload is not None
    assert payload["event"] == "step_started"
    assert payload["step"] == "dicom_to_nifti"
    assert payload["total_steps"] == 2


def test_hydrate_unknown_job(session_factory):
    hydrate = build_pipeline_ws_hydrate(session_factory)
    assert hydrate("missing") is None
