from __future__ import annotations

from fastapi import APIRouter, Request

from backend.schemas import (
    CreateStudyRequest,
    RenameStudyRequest,
    StudyResponse,
)

router = APIRouter(prefix="/storage/studies", tags=["studies"])


def _svc(request: Request):
    return request.app.state.study_service


@router.get("", response_model=list[StudyResponse])
def list_studies(request: Request, external_id: str | None = None):
    return _svc(request).list(external_id=external_id)


@router.post("", response_model=StudyResponse, status_code=201)
def create_study(request: Request, body: CreateStudyRequest):
    return _svc(request).create(
        external_id=body.external_id,
        name=body.name,
        meta=body.meta,
    )


@router.patch("/{study_id}", response_model=StudyResponse)
def rename_study(request: Request, study_id: str, body: RenameStudyRequest):
    return _svc(request).rename(study_id, body.name)


@router.delete("/{study_id}", status_code=204)
def delete_study(request: Request, study_id: str):
    _svc(request).delete(study_id)
