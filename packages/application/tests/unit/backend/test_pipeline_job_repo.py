"""PipelineJobRepo helpers."""

from backend.db.repos.pipeline_job_repo import PipelineJobRepo


def test_fail_interrupted_jobs_marks_running_and_queued_as_failed(db_session, make_study):
    repo = PipelineJobRepo(db_session)

    running_study = make_study("running-case")
    running_job = repo.get_by_study_id(running_study.id)
    repo.set_status(running_job.id, "running")

    queued_study = make_study("queued-case")
    repo.prepare_dispatch(queued_study.id, ["segment_nifti"])

    done_study = make_study("done-case")
    done_job = repo.get_by_study_id(done_study.id)
    repo.set_status(done_job.id, "completed")

    assert repo.fail_interrupted_jobs() == 2

    assert repo.get(running_job.id).status == "failed"
    assert repo.get(running_job.id).error is not None
    assert repo.get(repo.get_by_study_id(queued_study.id).id).status == "failed"
    assert repo.get(done_job.id).status == "completed"
