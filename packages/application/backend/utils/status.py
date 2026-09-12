from __future__ import annotations

# Soft no-op targets for cancel_for_study (already finished / never ran a pipeline).
PIPELINE_CANCEL_NOOP_STATUSES = frozenset(
    {"cancelled", "completed", "failed", "ready"}
)
# In-flight jobs that cancel must mark atomically, then stop workers.
PIPELINE_CANCEL_ACTIVE_STATUSES = ("queued", "running")


def study_workflow_display_status(job_status: str) -> str:
    """Map pipeline job status to values the frontend treats as processing/ready."""
    if job_status in ("queued", "running"):
        return "processing"
    if job_status in ("completed", "ready"):
        return "ready"
    if job_status == "created":
        return "created"
    if job_status == "failed":
        return "failed"
    if job_status == "cancelled":
        return "cancelled"
    return job_status
