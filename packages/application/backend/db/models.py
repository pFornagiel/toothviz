from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Column,
    DateTime,
    ForeignKey,
    Integer,
    JSON,
    String,
    Index,
    Text,
    text,
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
    name = Column(String, index=True)
    created_at = Column(DateTime, default=_time_now)

    files = relationship(
        "FileRecord", back_populates="study", cascade="all, delete-orphan"
    )
    pipeline_job = relationship(
        "PipelineJob",
        back_populates="study",
        uselist=False,
        cascade="all, delete-orphan",
    )


class FileRecord(Base):
    __tablename__ = "file_records"

    id = Column(String, primary_key=True, default=_new_id)
    study_id = Column(String, ForeignKey("studies.id", ondelete="CASCADE"), nullable=False)
    kind = Column(String, nullable=True)
    viewer_purpose = Column(String, nullable=True)
    display_name = Column(String, nullable=True)
    blob_hash = Column(String(64), index=True)
    size = Column(Integer, nullable=False)
    created_at = Column(DateTime, default=_time_now)

    study = relationship("Study", back_populates="files")

    __table_args__ = (
        Index("ix_file_records_study_id", "study_id"),
        Index("ix_file_records_study_viewer_purpose", "study_id", "viewer_purpose"),
        Index(
            "uq_file_records_study_viewer_purpose_active",
            "study_id",
            "viewer_purpose",
            unique=True,
            sqlite_where=text("viewer_purpose IS NOT NULL"),
        ),
    )


class UploadSession(Base):
    __tablename__ = "upload_sessions"

    id = Column(String, primary_key=True, default=_new_id)
    study_id = Column(String, ForeignKey("studies.id", ondelete="CASCADE"))
    filename = Column(String)
    kind = Column(String)
    state = Column(String, default="active", index=True)
    created_at = Column(DateTime, default=_time_now)


class PipelineJob(Base):
    __tablename__ = "pipeline_jobs"

    id = Column(String, primary_key=True, default=_new_id)
    study_id = Column(
        String,
        ForeignKey("studies.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )
    source_file_id = Column(
        String, ForeignKey("file_records.id", ondelete="SET NULL"), nullable=True
    )
    steps = Column(JSON, default=list)
    status = Column(String, default="created")
    created_at = Column(DateTime, default=_time_now)
    error = Column(Text, nullable=True)

    study = relationship("Study", back_populates="pipeline_job")
