from __future__ import annotations


def study_workflow_display_status(job_status: str) -> str:
    """Map pipeline job status to values the frontend treats as processing/ready."""
    if job_status in ("queued", "running"):
        return "processing"
    if job_status in ("completed", "ready"):
        return "ready"
    if job_status == "created":
        return "created"
    return job_status
