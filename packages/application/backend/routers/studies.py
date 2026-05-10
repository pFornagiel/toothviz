from __future__ import annotations

from fastapi import APIRouter, Request

from backend.db.repos.study_repo import StudyRepo
from backend.utils.status import study_workflow_display_status
from backend.schemas import (
    CreateStudyRequest,
    RenameStudyRequest,
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
