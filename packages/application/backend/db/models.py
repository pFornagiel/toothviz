from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import declarative_base, relationship

Base = declarative_base()


def _time_now() -> datetime:
    """Return UTC timestamp"""
    return datetime.now(timezone.utc)


def _new_id() -> str:
    """Return new unique ID"""
    return str(uuid.uuid4())


class Study(Base):
    __tablename__ = "studies"

    id = Column(String, primary_key=True, default=_new_id)
    name = Column(String, nullable=True)
    external_id = Column(String, unique=True, nullable=True, index=True)
    status = Column(String, default="created")
    created_at = Column(DateTime, default=_time_now)
    updated_at = Column(DateTime, default=_time_now, onupdate=_time_now)
    meta = Column(JSON, default=dict)

    files = relationship(
        "FileRecord", back_populates="study", cascade="all, delete-orphan"
    )


class Blob(Base):
    __tablename__ = "blobs"

    hash = Column(String(64), primary_key=True)
    size = Column(Integer, nullable=False)
    created_at = Column(DateTime, default=_time_now)


class FileRecord(Base):
    __tablename__ = "file_records"

    id = Column(String, primary_key=True, default=_new_id)
    study_id = Column(String, ForeignKey("studies.id", ondelete="CASCADE"), index=True)
    pipeline_job_id = Column(String, ForeignKey("pipeline_jobs.id"), nullable=True)
    role = Column(String, index=True)  # original | derived
    kind = Column(String, nullable=True)
    purpose = Column(String, nullable=True, index=True)
    original_filename = Column(String, nullable=True)
    rel_path = Column(Text)
    blob_hash = Column(String(64), ForeignKey("blobs.hash"), index=True)
    content_type = Column(String, nullable=True)
    size = Column(Integer, nullable=False)
    created_at = Column(DateTime, default=_time_now)
    meta = Column(JSON, default=dict)

    study = relationship("Study", back_populates="files")


Index("idx_file_records_role_kind", FileRecord.role, FileRecord.kind)
UniqueConstraint(FileRecord.study_id, FileRecord.rel_path, name="uq_study_relpath")


class UploadSession(Base):
    __tablename__ = "upload_sessions"

    id = Column(String, primary_key=True, default=_new_id)
    study_id = Column(String, ForeignKey("studies.id", ondelete="CASCADE"))
    filename = Column(String)
    role = Column(String, default="original")
    kind = Column(String)
    content_type = Column(String, nullable=True)
    expected_size = Column(Integer, nullable=True)
    expected_sha256 = Column(String(64), nullable=True)
    chunk_size = Column(Integer, nullable=False)
    state = Column(String, default="active", index=True)
    created_at = Column(DateTime, default=_time_now)
    updated_at = Column(DateTime, default=_time_now, onupdate=_time_now)


class PipelineJob(Base):
    __tablename__ = "pipeline_jobs"

    id = Column(String, primary_key=True, default=_new_id)
    study_id = Column(String, ForeignKey("studies.id", ondelete="CASCADE"), index=True)
    source_file_id = Column(String, ForeignKey("file_records.id"))
    steps = Column(JSON, default=list)
    status = Column(String, default="queued")
    created_at = Column(DateTime, default=_time_now)
    started_at = Column(DateTime, nullable=True)
    finished_at = Column(DateTime, nullable=True)
    error = Column(Text, nullable=True)
