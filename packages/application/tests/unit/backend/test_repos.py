import pytest

from backend.db.models import Study, FileRecord
from backend.db.repos.study_repo import StudyRepo, StudySortField, StudySortOrder
from backend.db.repos.upload_session_repo import UploadSessionRepo
from backend.db.repos.file_repo import FileRepo
from backend.db.repos.pipeline_job_repo import PipelineJobRepo
from backend.exceptions import NotFoundError


# -- Study --

def test_study_crud(db_session):
    repo = StudyRepo(db_session)
    study = repo.create(name="S1")
    assert study.name == "S1"

    fetched = repo.get(study.id)
    assert fetched.name == "S1"

    listed, total = repo.list()
    assert total == 1
    assert len(listed) == 1

    renamed = repo.rename(study.id, "S2")
    assert renamed.name == "S2"

    repo.delete(study.id)
    with pytest.raises(NotFoundError):
        repo.get(study.id)


def test_study_list_filter_name(db_session):
    repo = StudyRepo(db_session)
    repo.create(name="Alpha")
    repo.create(name="Beta")
    repo.create(name="Alphabet")

    results, total = repo.list(name="alp")
    assert total == 2
    assert {s.name for s in results} == {"Alpha", "Alphabet"}


def test_study_list_pagination(db_session):
    repo = StudyRepo(db_session)
    for i in range(5):
        repo.create(name=f"Scan_{i}")

    page1, total = repo.list(page=1, page_size=2)
    assert total == 5
    assert len(page1) == 2

    page3, total = repo.list(page=3, page_size=2)
    assert total == 5
    assert len(page3) == 1


def test_study_list_date_filter_and_sort(db_session):
    from datetime import date, datetime

    repo = StudyRepo(db_session)
    early = repo.create(name="Zebra")
    mid = repo.create(name="alpha")
    late = repo.create(name="Beta")

    early.created_at = datetime(2024, 1, 10, 12, 0, 0)
    mid.created_at = datetime(2024, 1, 15, 8, 0, 0)
    late.created_at = datetime(2024, 1, 20, 18, 0, 0)
    db_session.commit()

    results, total = repo.list(
        created_from=date(2024, 1, 15),
        created_to=date(2024, 1, 15),
    )
    assert total == 1
    assert results[0].id == mid.id

    results, total = repo.list(
        created_from=date(2024, 1, 10),
        created_to=date(2024, 1, 20),
        sort=(StudySortField.NAME, StudySortOrder.ASC),
    )
    assert total == 3
    assert [s.name for s in results] == ["alpha", "Beta", "Zebra"]

    results, _ = repo.list(sort=(StudySortField.NAME, StudySortOrder.DESC))
    assert [s.name for s in results] == ["Zebra", "Beta", "alpha"]

    results, _ = repo.list(sort=(StudySortField.CREATED, StudySortOrder.ASC))
    assert [s.id for s in results] == [early.id, mid.id, late.id]

    results, _ = repo.list(sort=(StudySortField.CREATED, StudySortOrder.DESC))
    assert [s.id for s in results] == [late.id, mid.id, early.id]


def test_study_list_sort_by_status(db_session):
    study_repo = StudyRepo(db_session)
    job_repo = PipelineJobRepo(db_session)

    ready = study_repo.create(name="Ready")
    failed = study_repo.create(name="Failed")
    processing = study_repo.create(name="Processing")
    cancelled = study_repo.create(name="Cancelled")

    for study, status in (
        (ready, "completed"),
        (failed, "failed"),
        (processing, "running"),
        (cancelled, "cancelled"),
    ):
        job = job_repo.create_for_study(study.id)
        job_repo.set_status(job.id, status)

    results, total = study_repo.list(sort=(StudySortField.STATUS, StudySortOrder.ASC))
    assert total == 4
    assert [s.name for s in results] == ["Cancelled", "Failed", "Processing", "Ready"]

    results, _ = study_repo.list(sort=(StudySortField.STATUS, StudySortOrder.DESC))
    assert [s.name for s in results] == ["Ready", "Processing", "Failed", "Cancelled"]


# -- UploadSession --

def test_upload_session_crud(db_session):
    db_session.add(Study(id="s1"))
    db_session.commit()

    repo = UploadSessionRepo(db_session)
    session = repo.create("s1", "file.nii", "nifti_raw")
    assert session.state == "active"

    fetched = repo.get(session.id)
    assert fetched.filename == "file.nii"

    repo.update_state(session.id, "finalized")
    assert repo.get(session.id).state == "finalized"


def test_upload_session_list_by_state(db_session):
    db_session.add(Study(id="s1"))
    db_session.commit()

    repo = UploadSessionRepo(db_session)
    repo.create("s1", "a.nii", "nifti_raw")
    s2 = repo.create("s1", "b.nii", "nifti_raw")
    repo.update_state(s2.id, "aborted")

    active = repo.list_by_state("active")
    assert len(active) == 1

    aborted = repo.list_by_state("aborted")
    assert len(aborted) == 1


# -- FileRepo --

def _setup_study_with_files(db_session):
    db_session.add(Study(id="s1"))
    db_session.commit()


def test_file_repo_create_and_list(db_session):
    _setup_study_with_files(db_session)
    repo = FileRepo(db_session)

    repo.create_file_record(
        file_id="f1",
        study_id="s1", kind="nifti_raw",
        viewer_purpose="viewer_volume", display_name="v.nii",
        blob_hash="a" * 64, size=100,
    )
    repo.create_file_record(
        file_id="f2",
        study_id="s1", kind="segmentation_mask",
        viewer_purpose="viewer_overlay", display_name="m.nii",
        blob_hash="a" * 64, size=100,
    )

    all_files = repo.list_by_study("s1")
    assert len(all_files) == 2

    volumes = repo.list_by_study("s1", viewer_purpose_filter=["viewer_volume"])
    assert len(volumes) == 1


def test_file_repo_clear_viewer_purpose_can_exclude_source(db_session):
    """Exclude keeps the source binding when clearing other rows with the same purpose.

    (study_id, viewer_purpose) is unique, so at most one row holds a purpose at a
    time — the exclude path is exercised by clearing when only the source matches
    (0 rows updated) and when a non-source derived row matches.
    """
    _setup_study_with_files(db_session)
    repo = FileRepo(db_session)

    repo.create_file_record(
        file_id="src",
        study_id="s1",
        kind="nifti_raw",
        viewer_purpose="viewer_volume",
        display_name="source.nii",
        blob_hash="a" * 64,
        size=100,
    )
    # Only the source holds viewer_volume — exclude leaves it untouched.
    cleared = repo.clear_viewer_purpose("s1", "viewer_volume", exclude_file_id="src")
    db_session.commit()
    assert cleared == 0
    volumes = repo.list_by_study("s1", viewer_purpose_filter=["viewer_volume"])
    assert len(volumes) == 1
    assert volumes[0].id == "src"

    # Replace with a derived volume (as DICOM conversion would), then clear
    # while excluding the (now unbound) source id — derived purpose is wiped.
    repo.clear_viewer_purpose("s1", "viewer_volume")
    repo.create_file_record(
        file_id="derived",
        study_id="s1",
        kind="nifti_derived",
        viewer_purpose="viewer_volume",
        display_name="derived.nii",
        blob_hash="b" * 64,
        size=100,
    )
    cleared = repo.clear_viewer_purpose("s1", "viewer_volume", exclude_file_id="src")
    db_session.commit()
    assert cleared == 1
    assert repo.list_by_study("s1", viewer_purpose_filter=["viewer_volume"]) == []


def test_file_repo_clear_viewer_purpose(db_session):
    _setup_study_with_files(db_session)
    repo = FileRepo(db_session)

    repo.create_file_record(
        file_id="f1",
        study_id="s1", kind="nifti_raw",
        viewer_purpose="viewer_volume", display_name="old.nii",
        blob_hash="a" * 64, size=100,
    )
    repo.clear_viewer_purpose("s1", "viewer_volume")

    repo.create_file_record(
        file_id="f2",
        study_id="s1", kind="nifti_raw",
        viewer_purpose="viewer_volume", display_name="new.nii",
        blob_hash="a" * 64, size=100,
    )
    db_session.commit()

    volumes = repo.list_by_study("s1", viewer_purpose_filter=["viewer_volume"])
    assert len(volumes) == 1
    assert volumes[0].display_name == "new.nii"


def test_file_repo_count_references(db_session):
    _setup_study_with_files(db_session)
    repo = FileRepo(db_session)

    repo.create_file_record(
        file_id="f1",
        study_id="s1", kind="nifti_raw",
        viewer_purpose=None, display_name="a.nii",
        blob_hash="a" * 64, size=100,
    )
    repo.create_file_record(
        file_id="f2",
        study_id="s1", kind="nifti_raw",
        viewer_purpose=None, display_name="b.nii",
        blob_hash="a" * 64, size=100,
    )

    assert repo.count_references("a" * 64) == 2


# -- PipelineJob --

def test_pipeline_job_crud(db_session):
    db_session.add(Study(id="s1"))
    db_session.add(FileRecord(
        id="f1", study_id="s1", kind="nifti_raw",
        display_name="x.nii", blob_hash="a" * 64, size=100,
    ))
    db_session.commit()

    repo = PipelineJobRepo(db_session)
    job = repo.create_for_study("s1")
    job.source_file_id = "f1"
    db_session.commit()
    assert job.status == "created"

    repo.set_status(job.id, "running")
    assert repo.get(job.id).status == "running"

    repo.set_status(job.id, "completed")
    assert repo.get(job.id).status == "completed"


def test_pipeline_job_get_active_for_study(db_session):
    db_session.add(Study(id="s1"))
    db_session.add(FileRecord(
        id="f1", study_id="s1", kind="nifti_raw",
        display_name="x.nii", blob_hash="a" * 64, size=100,
    ))
    db_session.commit()

    repo = PipelineJobRepo(db_session)
    job = repo.create_for_study("s1")
    job.source_file_id = "f1"
    db_session.commit()
    repo.prepare_dispatch("s1", ["segment_nifti"])
    job = repo.get_by_study_id("s1")
    repo.set_status(job.id, "running")

    active = repo.get_active_for_study("s1")
    assert active is not None
    assert active.id == job.id

    repo.set_status(job.id, "completed")
    assert repo.get_active_for_study("s1") is None
