"""Database engine, session and declarative base.

SQLite is the store for this build. WAL mode matters: the patient app writes
while the counsellor dashboard reads and the follow-up scheduler fires, and the
default rollback journal serialises all of that into `database is locked`.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Generator, Optional

from sqlalchemy import DateTime, Engine, TypeDecorator, create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import settings


def utcnow() -> datetime:
    """Timezone-aware UTC now.

    Pure services must never call this — they take the clock as a parameter
    (contract rule 2). It exists for persistence defaults only.
    """
    return datetime.now(timezone.utc)


class UTCDateTime(TypeDecorator):
    """A datetime column that is always timezone-aware UTC in Python.

    `DateTime(timezone=True)` is a no-op on SQLite: the dialect formats with a
    string that has no offset field, so an aware value is written with its
    offset silently dropped and read back naive. Two ways that bites:

      * A counsellor scheduling a call at 12:00 IST stored the wall clock 12:00
        and it was later read as 12:00 UTC — the call comes due 5.5 hours late.
      * Naive and aware values then meet in the same comparison and raise
        `can't compare offset-naive and offset-aware datetimes`, which took out
        the case-list sort on any case that had a report.

    So the conversion is done here rather than at each read site: normalise to
    UTC on the way in, re-attach UTC on the way out. Every timestamp in the
    system is UTC, and callers never have to ask whether this one happens to be
    aware. Naive input is assumed UTC — nothing in this build writes local time,
    and guessing a local zone would be worse than the assumption.
    """

    impl = DateTime
    cache_ok = True

    def __init__(self) -> None:
        super().__init__(timezone=True)

    def process_bind_param(
        self, value: Optional[datetime], dialect: Any
    ) -> Optional[datetime]:
        if value is None:
            return None
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)

    def process_result_value(
        self, value: Optional[datetime], dialect: Any
    ) -> Optional[datetime]:
        if value is None:
            return None
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)


class Base(DeclarativeBase):
    pass


_is_sqlite = settings.DATABASE_URL.startswith("sqlite")

engine: Engine = create_engine(
    settings.DATABASE_URL,
    # SQLite only: FastAPI serves requests from a threadpool, so the connection
    # must be usable across threads.
    connect_args={"check_same_thread": False} if _is_sqlite else {},
    pool_pre_ping=True,
    future=True,
)


if _is_sqlite:

    @event.listens_for(engine, "connect")
    def _sqlite_pragmas(dbapi_connection: Any, _connection_record: Any) -> None:
        cursor = dbapi_connection.cursor()
        # WAL: concurrent readers alongside one writer.
        cursor.execute("PRAGMA journal_mode=WAL")
        # Wait rather than immediately erroring when the writer lock is held.
        cursor.execute("PRAGMA busy_timeout=5000")
        # Enforce ON DELETE CASCADE / SET NULL, which SQLite ignores by default.
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.close()


SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency yielding a scoped session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    """Create tables that don't exist yet.

    Alembic owns schema evolution; this is for first-run bootstrap.
    """
    from app import models  # noqa: F401  (registers mappers)

    Base.metadata.create_all(bind=engine)
