"""Root-level shared fixtures."""

import pytest
from pathlib import Path
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.db.models import Base


@pytest.fixture()
def db_engine():
    """In-memory SQLite engine with foreign keys — single shared connection."""
    eng = create_engine(
        "sqlite:///:memory:",
        future=True,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    @event.listens_for(eng, "connect")
    def _pragmas(dbapi_conn, _):
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA foreign_keys=ON")
        cur.close()

    Base.metadata.create_all(eng)
    yield eng
    eng.dispose()


@pytest.fixture()
def db_session(db_engine):
    """Yields a session per test, rolls back after each test."""
    Session = sessionmaker(bind=db_engine, expire_on_commit=False)
    session = Session()
    yield session
    session.rollback()
    session.close()


@pytest.fixture()
def session_factory(db_engine):
    """Returns a session factory bound to the shared in-memory engine."""
    factory = sessionmaker(bind=db_engine, expire_on_commit=False)
    return factory


@pytest.fixture()
def tmp_data_root(tmp_path):
    """Creates the standard data directory structure in a temp folder."""
    root = tmp_path / "data"
    (root / "blobs" / "sha256").mkdir(parents=True)
    (root / "studies").mkdir(parents=True)
    (root / "uploads").mkdir(parents=True)
    return root
