from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Query, Request

from backend.db.repos.study_repo import (
    DEFAULT_STUDY_SORT,
    StudyRepo,
    StudySortField,
    StudySortOrder,
)
from backend.utils.status import study_workflow_display_status
from backend.schemas import (
    CreateStudyRequest,
    RenameStudyRequest,
    StudyListResponse,
    StudyResponse,
)

router = APIRouter(prefix="/storage/studies", tags=["studies"])


def _svc(request: Request):
    return request.app.state.study_service


def _study_response(study, pipeline_job) -> StudyResponse:
    if pipeline_job is None:
        return StudyResponse(
            id=study.id,
            name=study.name,
            created_at=study.created_at,
            status="created",
        )
    return StudyResponse(
        id=study.id,
        name=study.name,
        created_at=study.created_at,
        status=study_workflow_display_status(pipeline_job.status),
        job_id=pipeline_job.id,
        pipeline_status=pipeline_job.status,
        steps=list(pipeline_job.steps or []),
        error=pipeline_job.error,
        source_file_id=pipeline_job.source_file_id,
    )


@router.get("/{study_id}", response_model=StudyResponse)
def get_study(request: Request, study_id: str):
    storage_svc = request.app.state.storage_service
    with storage_svc.session_factory() as db:
        s = StudyRepo(db).get_with_pipeline_job(study_id)
    return _study_response(s, s.pipeline_job)


@router.get("", response_model=StudyListResponse)
def list_studies(
    request: Request,
    name: str | None = Query(None, description="Case-insensitive substring filter on study name"),
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100),
    created_from: date | None = Query(
        None, description="Inclusive start date (YYYY-MM-DD) on study created_at"
    ),
    created_to: date | None = Query(
        None, description="Inclusive end date (YYYY-MM-DD) on study created_at"
    ),
    sort_by: StudySortField = Query(
        DEFAULT_STUDY_SORT[0],
        description="Sort field: created, name, or status",
    ),
    order: StudySortOrder = Query(
        DEFAULT_STUDY_SORT[1],
        description="Sort direction: asc or desc",
    ),
):
    studies, total = _svc(request).list(
        name=name,
        page=page,
        page_size=page_size,
        created_from=created_from,
        created_to=created_to,
        sort=(sort_by, order),
    )
    return StudyListResponse(
        items=[_study_response(s, s.pipeline_job) for s in studies],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.post("", response_model=StudyResponse, status_code=201)
def create_study(request: Request, body: CreateStudyRequest):
    study = _svc(request).create(name=body.name)
    storage_svc = request.app.state.storage_service
    with storage_svc.session_factory() as db:
        s = StudyRepo(db).get_with_pipeline_job(study.id)
    return _study_response(s, s.pipeline_job)


@router.patch("/{study_id}", response_model=StudyResponse)
def rename_study(request: Request, study_id: str, body: RenameStudyRequest):
    _svc(request).rename(study_id, body.name)
    storage_svc = request.app.state.storage_service
    with storage_svc.session_factory() as db:
        s = StudyRepo(db).get_with_pipeline_job(study_id)
    return _study_response(s, s.pipeline_job)


@router.delete("/{study_id}", status_code=204)
def delete_study(request: Request, study_id: str):
    _svc(request).delete(study_id)


@router.post("/{study_id}/pipeline:retry", response_model=StudyResponse)
def retry_pipeline(request: Request, study_id: str):
    """Re-dispatch the pipeline for a failed/cancelled study that still has a source file."""
    storage_svc = request.app.state.storage_service
    pipeline_svc = request.app.state.job_pipeline_service
    with storage_svc.session_factory() as db:
        pipeline_svc.retry(study_id, db)
        s = StudyRepo(db).get_with_pipeline_job(study_id)
    return _study_response(s, s.pipeline_job)


@router.post("/{study_id}/pipeline:cancel", response_model=StudyResponse)
def cancel_pipeline(request: Request, study_id: str):
    """Stop an in-flight (or not-yet-started) pipeline; keeps the study for retry."""
    storage_svc = request.app.state.storage_service
    pipeline_svc = request.app.state.job_pipeline_service
    with storage_svc.session_factory() as db:
        pipeline_svc.cancel_for_study(study_id, db)
        s = StudyRepo(db).get_with_pipeline_job(study_id)
    return _study_response(s, s.pipeline_job)
