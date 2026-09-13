"""API-level tests for counsellor-set follow-ups.

These cover the two things the unit tests could not: that a timezone-aware time
survives the round trip through SQLite, and that a manually-scheduled row (which
has no predicted cadence) serialises at all.

Both were real bugs. `DateTime(timezone=True)` is a no-op on SQLite, so 11:00
IST was stored and re-read as 11:00 UTC — a call 5.5 hours late. And
`FollowUpOut.cadence_factors` was a non-optional list over a nullable column, so
POST /schedule-call returned 500 on success: the row was written, the response
blew up, and the counsellor saw a failure for a call that had been scheduled.

Uses a file-backed temp SQLite database rather than `sqlite://` because the app's
engine is module-level and shared across the TestClient's threads.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.database import Base, SessionLocal, engine
from app.core.security import hash_password
from app.main import app
from app.models import Case, FollowUp, StaffUser, User

IST = timezone(timedelta(hours=5, minutes=30))


@pytest.fixture()
def db() -> Session:
    Base.metadata.create_all(bind=engine)
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture()
def seeded(db: Session) -> dict[str, int]:
    """One staff account and one case, cleaned up after the test."""
    staff = StaffUser(
        name="Test Caseworker",
        email="api-test@viora.local",
        password_hash=hash_password("viora1234"),
        role="DSWO",
    )
    user = User(uid="VRA-APITEST", display_name="API Test Person", preferred_language="hi")
    db.add_all([staff, user])
    db.flush()
    case = Case(user_id=user.id, case_ref="CASE-APITEST-1", status="ACTIVE")
    db.add(case)
    db.commit()

    ids = {"case_id": case.id, "user_id": user.id, "staff_id": staff.id}
    yield ids

    db.query(FollowUp).filter(FollowUp.case_id == ids["case_id"]).delete()
    db.query(Case).filter(Case.id == ids["case_id"]).delete()
    db.query(User).filter(User.id == ids["user_id"]).delete()
    db.query(StaffUser).filter(StaffUser.id == ids["staff_id"]).delete()
    db.commit()


@pytest.fixture()
def client() -> TestClient:
    return TestClient(app)


@pytest.fixture()
def auth(client: TestClient, seeded: dict[str, int]) -> dict[str, str]:
    token = client.post(
        "/api/v1/auth/login",
        json={"email": "api-test@viora.local", "password": "viora1234"},
    ).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_scheduling_a_call_returns_the_row_rather_than_500(client, auth, seeded):
    """A manual follow-up has no cadence prediction; that must still serialise.

    The row was being written and then the response validation was failing, so
    the counsellor saw an error for a call that had in fact been scheduled.
    """
    when = datetime.now(timezone.utc) + timedelta(days=1)
    response = client.post(
        f"/api/v1/cases/{seeded['case_id']}/schedule-call",
        headers=auth,
        json={"scheduled_for": when.isoformat(), "channel": "VOICE", "note": "n"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["source"] == "COUNSELLOR"
    assert body["cadence_factors"] == []
    assert body["cadence_hours"] is None


def test_a_non_utc_scheduled_time_keeps_its_instant(client, auth, seeded, db):
    """11:00 IST is 05:30 UTC — storing 11:00 UTC would delay the call 5.5 hours.

    SQLite has no offset field, so the offset has to be applied on the way in
    (UTCDateTime) rather than trusted to the column.
    """
    tomorrow = (datetime.now(IST) + timedelta(days=1)).replace(
        hour=11, minute=0, second=0, microsecond=0
    )
    response = client.post(
        f"/api/v1/cases/{seeded['case_id']}/schedule-call",
        headers=auth,
        json={"scheduled_for": tomorrow.isoformat(), "channel": "VOICE"},
    )
    assert response.status_code == 200, response.text

    row = db.get(FollowUp, response.json()["id"])
    db.refresh(row)
    assert row.scheduled_for.tzinfo is not None, "read back naive — the offset was lost"
    assert row.scheduled_for == tomorrow.astimezone(timezone.utc)
    assert row.scheduled_for.hour == 5 and row.scheduled_for.minute == 30


def test_a_past_time_is_rejected(client, auth, seeded):
    """Almost always a timezone mistake, and it would come due immediately."""
    past = datetime.now(timezone.utc) - timedelta(hours=1)
    response = client.post(
        f"/api/v1/cases/{seeded['case_id']}/schedule-call",
        headers=auth,
        json={"scheduled_for": past.isoformat(), "channel": "VOICE"},
    )
    assert response.status_code == 422


def test_the_due_list_and_case_follow_ups_serialise(client, auth, seeded):
    """Both read paths render manual rows, which is where the NULL column bit."""
    when = datetime.now(timezone.utc) + timedelta(days=1)
    client.post(
        f"/api/v1/cases/{seeded['case_id']}/schedule-call",
        headers=auth,
        json={"scheduled_for": when.isoformat(), "channel": "VOICE"},
    )
    assert client.get("/api/v1/follow-ups/due", headers=auth).status_code == 200
    listed = client.get(f"/api/v1/cases/{seeded['case_id']}/follow-ups", headers=auth)
    assert listed.status_code == 200, listed.text
    assert any(r["source"] == "COUNSELLOR" for r in listed.json())
