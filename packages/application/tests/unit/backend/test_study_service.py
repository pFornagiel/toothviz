import pytest

from backend.db.repos.pipeline_job_repo import PipelineJobRepo
from backend.db.repos.study_repo import StudySortField, StudySortOrder
from backend.exceptions import ConflictError, ValidationError
from backend.services.study_service import StudyService


@pytest.fixture()
def study_service(storage_service):
    return StudyService(storage_service, job_pipeline_service=None)


def test_create_study(study_service, session_factory):
    study = study_service.create(name="My Study")
    assert study.name == "My Study"

    with session_factory() as db:
        job = PipelineJobRepo(db).get_by_study_id(study.id)
        assert job.status == "created"


def test_list_studies_filter_name(study_service):
    study_service.create(name="Alpha")
    study_service.create(name="Beta")
    study_service.create(name="Alphabet")

    results, total = study_service.list(name="alp")
    assert total == 2
    assert {s.name for s in results} == {"Alpha", "Alphabet"}


def test_list_studies(study_service):
    study_service.create(name="A")
    study_service.create(name="B")
    study_service.create(name="C")

    studies, total = study_service.list()
    assert total == 3
    assert len(studies) == 3


def test_list_studies_pagination(study_service):
    for i in range(5):
        study_service.create(name=f"Scan_{i}")

    page1, total = study_service.list(page=1, page_size=2)
    assert total == 5
    assert len(page1) == 2

    page3, total = study_service.list(page=3, page_size=2)
    assert total == 5
    assert len(page3) == 1


def test_list_studies_rejects_invalid_pagination(study_service):
    with pytest.raises(ValidationError, match="page must be >= 1"):
        study_service.list(page=0)
    with pytest.raises(ValidationError, match="page_size must be >= 1"):
        study_service.list(page_size=0)
    with pytest.raises(ValidationError, match="page_size must be <= 100"):
        study_service.list(page_size=101)


def test_list_studies_rejects_invalid_sort_and_date_range(study_service):
    from datetime import date

    with pytest.raises(ValidationError, match="sort must be a \\(field, order\\) pair"):
        study_service.list(sort=("not_a_field", StudySortOrder.ASC))  # type: ignore[arg-type]
    with pytest.raises(ValidationError, match="created_from must be <= created_to"):
        study_service.list(
            created_from=date(2024, 2, 1),
            created_to=date(2024, 1, 1),
        )


def test_list_studies_date_filter_and_sort(study_service, session_factory):
    from datetime import date, datetime

    from backend.db.models import Study

    a = study_service.create(name="Charlie")
    b = study_service.create(name="alpha")
    c = study_service.create(name="Bravo")

    with session_factory() as db:
        db.get(Study, a.id).created_at = datetime(2024, 3, 1, 10, 0, 0)
        db.get(Study, b.id).created_at = datetime(2024, 3, 5, 10, 0, 0)
        db.get(Study, c.id).created_at = datetime(2024, 3, 10, 10, 0, 0)
        db.commit()

    results, total = study_service.list(
        created_from=date(2024, 3, 5),
        created_to=date(2024, 3, 10),
        sort=(StudySortField.NAME, StudySortOrder.ASC),
    )
    assert total == 2
    assert [s.name for s in results] == ["alpha", "Bravo"]


def test_rename_study(study_service):
    study = study_service.create(name="Old")
    renamed = study_service.rename(study.id, "New")
    assert renamed.name == "New"


def test_create_study_rejects_duplicate_name(study_service):
    study_service.create(name="Scan_1")

    with pytest.raises(ConflictError, match=r'^A scan named "Scan_1" already exists\.$'):
        study_service.create(name="Scan_1")
    with pytest.raises(ConflictError, match='"Scan_1" already exists. Names are not case-sensitive'):
        study_service.create(name="  scan_1 ")

    assert study_service.list()[1] == 1


def test_create_study_rejects_blank_name(study_service):
    with pytest.raises(ValidationError):
        study_service.create(name="   ")


def test_rename_study_rejects_name_of_other_study(study_service):
    study_service.create(name="Taken")
    study = study_service.create(name="Mine")

    with pytest.raises(ConflictError, match='"Taken" already exists'):
        study_service.rename(study.id, "taken")

    assert study_service.list(name="Mine")[0][0].id == study.id


def test_rename_study_to_own_name_is_allowed(study_service):
    study = study_service.create(name="Mine")
    renamed = study_service.rename(study.id, "MINE")
    assert renamed.name == "MINE"


def test_delete_study_removes_files_and_dirs(
    study_service, storage_service, session_factory,
):
    study = study_service.create(name="to-delete")

    storage_service.engine.initialize_upload("u1")
    storage_service.engine.write_chunk("u1", 0, b"data")
    storage_service.store_original(
        "u1", study.id, "file.nii", "nifti_raw", None, None, None,
    )

    study_service.delete(study.id)

    study_dir = storage_service.engine.root / "studies" / study.id
    assert not study_dir.exists()


def test_delete_study_with_null_pipeline_service(study_service):
    study = study_service.create(name="safe-delete")
    study_service.delete(study.id)
