from __future__ import annotations
from datetime import datetime
from sqlalchemy import (
    Column, String, Integer, DateTime, Text, ForeignKey, JSON, Index, UniqueConstraint
)
from sqlalchemy.orm import declarative_base, relationship

Base = declarative_base()


class Study(Base):
    __tablename__ = "studies"

    id = Column(String, primary_key=True)
    external_id = Column(String, index=True, nullable=True)
    status = Column(String, default="created")
    created_at = Column(DateTime, default=datetime.utcnow)
    meta = Column(JSON, default=dict)

    files = relationship("FileRecord", back_populates="study", cascade="all, delete-orphan")


class Blob(Base): #CAS - content addressed storage
    __tablename__ = "blobs"

    hash = Column(String(64), primary_key=True)
    size = Column(Integer, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class FileRecord(Base):
    __tablename__ = "files"

    id = Column(String, primary_key=True)
    study_id = Column(String, ForeignKey("studies.id", ondelete="CASCADE"), index=True)
    role = Column(String, index=True)        # original | derived | thumb | log
    kind = Column(String, nullable=True)     # nifti | segmentation | denoise | labels | png | etc.
    rel_path = Column(Text)                  # path relative to storage root (study link path)
    blob_hash = Column(String(64), ForeignKey("blobs.hash"), index=True)
    content_type = Column(String, nullable=True)
    size = Column(Integer, nullable=False)
    checksum_sha256 = Column(String(64), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    meta = Column(JSON, default=dict)

    study = relationship("Study", back_populates="files")


Index("idx_files_role_kind", FileRecord.role, FileRecord.kind)
UniqueConstraint(FileRecord.study_id, FileRecord.rel_path, name="uq_study_relpath")


class UploadSession(Base):
    __tablename__ = "uploads"

    id = Column(String, primary_key=True)
    study_id = Column(String, ForeignKey("studies.id", ondelete="CASCADE"))
    role = Column(String)
    kind = Column(String)
    filename = Column(String)
    content_type = Column(String, nullable=True)
    expected_size = Column(Integer, nullable=True)
    expected_sha256 = Column(String(64), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    state = Column(String, default="active")  # active | finalized | aborted