"""The endpoints a person drives about their own care.

Four things the patient app needs and the counsellor API deliberately will not
give it: reading back their own conversation, moving their own check-in,
clearing it, and changing their own safe hours.

The security-relevant case here is the transcript. This router has no auth — the
phone picks a profile and talks to the backend over the LAN — so the only thing
standing between one person's conversation and another's is the ownership check
in `get_patient_transcript`. `test_transcript_of_another_persons_check_in_is_404`
is that guarantee.

The scheduling tests are about the safe-contact window, which until this change
nothing enforced anywhere: the columns existed, `seed.py` wrote them, the
counsellor view displayed them, and no code path ever refused a slot outside
them. For someone whose abuser may be in the house, a check-in at the wrong hour
is not an inconvenience.

File-backed temp SQLite for the same reason as `test_api_followups.py`: the
app's engine is module-level and shared across the TestClient's threads.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.database import Base, SessionLocal, engine
from app.main import app
from app.models import Case, ConversationMessage, FollowUp, Interaction, User
from app.services import scheduler

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
    """Two people, each with a case. The second one exists only so the
    transcript ownership check has something real to be refused."""
    mine = User(
        uid="VRA-SELFTEST",
        display_name="Self Test Person",
        preferred_language="hi",
        preferred_channel="TEXT",
        safe_contact_start="10:00",
        safe_contact_end="17:00",
        timezone="Asia/Kolkata",
    )
    other = User(
        uid="VRA-OTHERTEST",
        display_name="Other Person",
        preferred_language="hi",
        safe_contact_start="10:00",
        safe_contact_end="17:00",
        timezone="Asia/Kolkata",
    )
    db.add_all([mine, other])
    db.flush()

    my_case = Case(user_id=mine.id, case_ref="CASE-SELFTEST-1", status="ACTIVE")
    other_case = Case(user_id=other.id, case_ref="CASE-OTHERTEST-1", status="ACTIVE")
    db.add_all([my_case, other_case])
    db.flush()

    started = datetime.now(timezone.utc) - timedelta(days=1)
    my_interaction = Interaction(
        case_id=my_case.id, channel="TEXT", language="hi", status="COMPLETED",
        started_at=started, ended_at=started + timedelta(minutes=8), turn_count=2,
    )
    other_interaction = Interaction(
        case_id=other_case.id, channel="TEXT", language="hi", status="COMPLETED",
        started_at=started, ended_at=started + timedelta(minutes=5), turn_count=1,
    )
    db.add_all([my_interaction, other_interaction])
    db.flush()

    db.add_all([
        ConversationMessage(
            interaction_id=my_interaction.id, seq=1, role="VIORA",
            content="नमस्ते। इस हफ्ते कैसा रहा?", created_at=started,
        ),
        ConversationMessage(
            interaction_id=my_interaction.id, seq=2, role="USER",
            content="थोड़ा थकान है।", created_at=started,
        ),
        ConversationMessage(
            interaction_id=other_interaction.id, seq=1, role="USER",
            content="This belongs to somebody else.", created_at=started,
        ),
    ])
    db.commit()

    ids = {
        "uid": mine.uid,
        "other_uid": other.uid,
        "user_id": mine.id,
        "other_user_id": other.id,
        "case_id": my_case.id,
        "other_case_id": other_case.id,
        "interaction_id": my_interaction.id,
        "other_interaction_id": other_interaction.id,
    }
    yield ids

    for case_id in (ids["case_id"], ids["other_case_id"]):
        db.query(FollowUp).filter(FollowUp.case_id == case_id).delete()
    for interaction_id in (ids["interaction_id"], ids["other_interaction_id"]):
        db.query(ConversationMessage).filter(
            ConversationMessage.interaction_id == interaction_id
        ).delete()
        db.query(Interaction).filter(Interaction.id == interaction_id).delete()
    db.query(Case).filter(Case.id.in_([ids["case_id"], ids["other_case_id"]])).delete(
        synchronize_session=False
    )
    db.query(User).filter(User.id.in_([ids["user_id"], ids["other_user_id"]])).delete(
        synchronize_session=False
    )
    db.commit()


@pytest.fixture()
def client() -> TestClient:
    return TestClient(app)


def _inside_safe_window(days: int = 1) -> datetime:
    """A slot at 11:00 IST, which is inside the seeded 10:00-17:00 window."""
    return (datetime.now(IST) + timedelta(days=days)).replace(
        hour=11, minute=0, second=0, microsecond=0
    )


# ------------------------------------------------------------ transcript ----

def test_a_person_can_read_back_their_own_conversation(client, seeded):
    response = client.get(
        f"/api/v1/patients/{seeded['uid']}"
        f"/interactions/{seeded['interaction_id']}/transcript"
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert [m["seq"] for m in body["messages"]] == [1, 2]
    assert body["messages"][1]["content"] == "थोड़ा थकान है।"
    # The caseworker's handle on the file is not the person's business.
    assert "case_id" not in body


def test_transcript_of_another_persons_check_in_is_404(client, seeded):
    """The whole reason this endpoint is not just the counsellor's one.

    404 rather than 403: "that exists, but not for you" confirms the record is
    real, which is exactly what a caller walking interaction ids wants to learn.
    """
    response = client.get(
        f"/api/v1/patients/{seeded['uid']}"
        f"/interactions/{seeded['other_interaction_id']}/transcript"
    )
    assert response.status_code == 404
    assert "somebody else" not in response.text


# ------------------------------------------------------------- scheduling ----

def test_a_person_can_move_their_own_check_in(client, seeded, db):
    when = _inside_safe_window()
    response = client.post(
        f"/api/v1/patients/{seeded['uid']}/schedule",
        json={"scheduled_for": when.isoformat(), "channel": "TEXT"},
    )
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "SCHEDULED"

    row = db.query(FollowUp).filter(FollowUp.case_id == seeded["case_id"]).one()
    assert row.source == "PATIENT"
    # 11:00 IST is 05:30 UTC. Storing the wall-clock number would move the call
    # five and a half hours — the bug `test_api_followups` caught for counsellors.
    assert row.scheduled_for.astimezone(IST).hour == 11


def test_a_slot_outside_the_safe_window_is_refused(client, seeded):
    """22:00 is outside 10:00-17:00. This is the check that did not exist."""
    when = (datetime.now(IST) + timedelta(days=1)).replace(
        hour=22, minute=0, second=0, microsecond=0
    )
    response = client.post(
        f"/api/v1/patients/{seeded['uid']}/schedule",
        json={"scheduled_for": when.isoformat(), "channel": "TEXT"},
    )
    assert response.status_code == 422
    assert "safe hours" in response.json()["detail"]


def test_a_slot_a_minute_from_now_is_refused_as_a_mis_tap(client, seeded):
    when = datetime.now(timezone.utc) + timedelta(minutes=1)
    response = client.post(
        f"/api/v1/patients/{seeded['uid']}/schedule",
        json={"scheduled_for": when.isoformat(), "channel": "TEXT"},
    )
    assert response.status_code == 422
    assert "15 minutes" in response.json()["detail"]


def test_a_slot_in_the_past_is_refused(client, seeded):
    when = datetime.now(timezone.utc) - timedelta(hours=2)
    response = client.post(
        f"/api/v1/patients/{seeded['uid']}/schedule",
        json={"scheduled_for": when.isoformat(), "channel": "TEXT"},
    )
    assert response.status_code == 422


def test_rescheduling_cancels_the_previous_row_rather_than_deleting_it(
    client, seeded, db
):
    """A caseworker looking at the case must still see that the time moved."""
    predicted = FollowUp(
        case_id=seeded["case_id"],
        scheduled_for=datetime.now(timezone.utc) + timedelta(days=3),
        channel="VOICE", status="SCHEDULED", reason="Predicted", source="PREDICTED",
    )
    db.add(predicted)
    db.commit()
    predicted_id = predicted.id

    response = client.post(
        f"/api/v1/patients/{seeded['uid']}/schedule",
        json={"scheduled_for": _inside_safe_window().isoformat(), "channel": "TEXT"},
    )
    assert response.status_code == 200, response.text

    db.expire_all()
    assert db.get(FollowUp, predicted_id).status == "CANCELLED"
    rows = db.query(FollowUp).filter(FollowUp.case_id == seeded["case_id"]).all()
    assert {r.status for r in rows} == {"CANCELLED", "SCHEDULED"}


def test_a_person_can_clear_a_predicted_check_in(client, seeded, db):
    db.add(FollowUp(
        case_id=seeded["case_id"],
        scheduled_for=datetime.now(timezone.utc) + timedelta(days=3),
        channel="VOICE", status="SCHEDULED", reason="Predicted", source="PREDICTED",
    ))
    db.commit()

    response = client.delete(f"/api/v1/patients/{seeded['uid']}/schedule")
    assert response.status_code == 204

    db.expire_all()
    rows = db.query(FollowUp).filter(FollowUp.case_id == seeded["case_id"]).all()
    assert all(r.status == "CANCELLED" for r in rows)


def test_a_counsellor_set_call_cannot_be_deleted_from_the_phone(client, seeded, db):
    """The person controls WHEN, not WHETHER.

    A caseworker's decision that a check-in should happen is not silently undone
    from the app — but the 409 says so in the person's own terms, and moving it
    to a safe hour still works.
    """
    db.add(FollowUp(
        case_id=seeded["case_id"],
        scheduled_for=datetime.now(timezone.utc) + timedelta(days=2),
        channel="VOICE", status="SCHEDULED",
        reason="Scheduled by counsellor", source="COUNSELLOR",
    ))
    db.commit()

    response = client.delete(f"/api/v1/patients/{seeded['uid']}/schedule")
    assert response.status_code == 409
    assert "caseworker" in response.json()["detail"]

    db.expire_all()
    rows = db.query(FollowUp).filter(FollowUp.case_id == seeded["case_id"]).all()
    assert any(r.status == "SCHEDULED" for r in rows)

    # ...but moving it is allowed.
    moved = client.post(
        f"/api/v1/patients/{seeded['uid']}/schedule",
        json={"scheduled_for": _inside_safe_window(days=2).isoformat(), "channel": "VOICE"},
    )
    assert moved.status_code == 200, moved.text


# ------------------------------------------------------------ preferences ----

def test_a_person_can_change_their_safe_hours(client, seeded, db):
    response = client.patch(
        f"/api/v1/patients/{seeded['uid']}/preferences",
        json={"safe_contact_start": "09:00", "safe_contact_end": "13:00"},
    )
    assert response.status_code == 200, response.text
    assert response.json()["safe_contact_start"] == "09:00"

    # And the new window is what the next slot is judged against: 15:00 was
    # inside the old 10:00-17:00 and is outside the new one.
    when = (datetime.now(IST) + timedelta(days=1)).replace(
        hour=15, minute=0, second=0, microsecond=0
    )
    refused = client.post(
        f"/api/v1/patients/{seeded['uid']}/schedule",
        json={"scheduled_for": when.isoformat(), "channel": "TEXT"},
    )
    assert refused.status_code == 422


def test_a_malformed_safe_window_is_refused(client, seeded):
    """A half-written window would make every later check fall through to
    "cannot verify, allow" — which is how an unenforced window looks."""
    response = client.patch(
        f"/api/v1/patients/{seeded['uid']}/preferences",
        json={"safe_contact_start": "9am"},
    )
    assert response.status_code == 422
    assert "HH:MM" in response.json()["detail"]


def test_an_unsupported_language_is_refused(client, seeded):
    response = client.patch(
        f"/api/v1/patients/{seeded['uid']}/preferences",
        json={"preferred_language": "fr"},
    )
    assert response.status_code == 422


def test_a_patch_leaves_untouched_fields_alone(client, seeded):
    response = client.patch(
        f"/api/v1/patients/{seeded['uid']}/preferences",
        json={"preferred_channel": "VOICE"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["preferred_channel"] == "VOICE"
    assert body["preferred_language"] == "hi"
    assert body["safe_contact_start"] == "10:00"


# --------------------------------------------------------- window policy ----

@pytest.mark.parametrize(
    "minutes,expected",
    [
        (9 * 60, False),      # 09:00, before the window
        (10 * 60, True),      # 10:00, the boundary is inclusive
        (13 * 60, True),
        (17 * 60, True),      # 17:00, the far boundary
        (17 * 60 + 1, False),
    ],
)
def test_window_boundaries(minutes: int, expected: bool):
    assert scheduler.within_window(minutes, "10:00", "17:00") is expected


@pytest.mark.parametrize("minutes,expected", [(23 * 60, True), (3 * 60, True), (12 * 60, False)])
def test_a_window_that_wraps_past_midnight(minutes: int, expected: bool):
    """A night-shift worker's safe hours legitimately look like 22:00-06:00.

    No seeded profile uses one, so without this the first person who did would
    find every slot refused, with nothing to explain why.
    """
    assert scheduler.within_window(minutes, "22:00", "06:00") is expected


def test_an_unusable_window_does_not_lock_the_person_out():
    """Refusing every time because a stored string is malformed is a worse
    failure than accepting a slot we could not check."""
    assert scheduler.within_window(11 * 60, "not a time", "17:00") is True
