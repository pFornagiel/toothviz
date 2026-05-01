from __future__ import annotations

from fastapi import APIRouter, Request

from backend.db.repos.study_repo import StudyRepo
from backend.schemas import (
    CreateStudyRequest,
    RenameStudyRequest,
    StudyResponse,
    study_workflow_display_status,
)

router = APIRouter(prefix="/storage/studies", tags=["studies"])


def _svc(request: Request):
    return request.app.state.study_service


def _study_response(study, pipeline_job) -> StudyResponse:
    status = (
        study_workflow_display_status(pipeline_job.status)
        if pipeline_job is not None
        else "created"
    )
    return StudyResponse(
        id=study.id,
        name=study.name,
        created_at=study.created_at,
        status=status,
    )


@router.get("", response_model=list[StudyResponse])
def list_studies(request: Request, name: str | None = None):
    studies = _svc(request).list(name=name)
    return [
        _study_response(s, s.pipeline_job)
        for s in studies
    ]


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
