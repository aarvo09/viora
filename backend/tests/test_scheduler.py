"""Follow-up scheduler tests.

Uses a real in-memory SQLite database rather than mocks: the sweep is mostly
about state transitions and ordering, and a mocked session would test the mock.
`now` is injected everywhere, so nothing here depends on the wall clock.

Run:  cd backend && python -m pytest tests/ -v
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.models import Case, FollowUp, User, WorkflowEvent
from app.services import scheduler

NOW = datetime(2026, 3, 10, 9, 0, tzinfo=timezone.utc)


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine, autoflush=False, future=True)()
    try:
        yield session
    finally:
        session.close()
        engine.dispose()


@pytest.fixture()
def case(db):
    user = User(uid="u-test-1", display_name="Test Person", preferred_language="hi")
    db.add(user)
    db.flush()
    c = Case(user_id=user.id, case_ref="VIORA-TEST-1", status="ACTIVE")
    db.add(c)
    db.commit()
    return c


def add_follow_up(db, case, *, days_from_now: float, reason="Routine monitoring",
                  status="SCHEDULED", source="PREDICTED") -> FollowUp:
    row = FollowUp(
        case_id=case.id,
        scheduled_for=NOW + timedelta(days=days_from_now),
        channel="TEXT",
        status=status,
        reason=reason,
        policy_version="1.0.0",
        source=source,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


# --------------------------------------------------------------------------
# SCHEDULED → DUE
# --------------------------------------------------------------------------

def test_future_follow_up_is_untouched(db, case):
    row = add_follow_up(db, case, days_from_now=3)
    result = scheduler.sweep(db, now=NOW)
    db.refresh(row)
    assert row.status == "SCHEDULED"
    assert result.became_due == 0


def test_follow_up_due_today_becomes_due(db, case):
    row = add_follow_up(db, case, days_from_now=0)
    result = scheduler.sweep(db, now=NOW)
    db.refresh(row)
    assert row.status == "DUE"
    assert result.became_due == 1


def test_overdue_follow_up_becomes_due(db, case):
    row = add_follow_up(db, case, days_from_now=-2)
    scheduler.sweep(db, now=NOW)
    db.refresh(row)
    assert row.status == "DUE"


# --------------------------------------------------------------------------
# DUE → MISSED, and the grace period
# --------------------------------------------------------------------------

def test_routine_follow_up_gets_the_default_grace_period(db, case):
    row = add_follow_up(db, case, days_from_now=-5, reason="Routine monitoring")
    scheduler.sweep(db, now=NOW)
    db.refresh(row)
    # 5 days overdue, 7-day grace — a hard week is not a missed follow-up.
    assert row.status == "DUE"


def test_routine_follow_up_is_missed_past_the_grace_period(db, case):
    row = add_follow_up(db, case, days_from_now=-8, reason="Routine monitoring")
    result = scheduler.sweep(db, now=NOW)
    db.refresh(row)
    assert row.status == "MISSED"
    assert result.became_missed == 1


def test_urgent_follow_up_has_a_short_grace_period(db, case):
    row = add_follow_up(
        db, case, days_from_now=-3,
        reason="Urgent concern disclosed — immediate follow-up",
    )
    scheduler.sweep(db, now=NOW)
    db.refresh(row)
    # An unanswered next-day URGENT check-in must surface fast.
    assert row.status == "MISSED"


def test_urgent_follow_up_within_grace_stays_due(db, case):
    row = add_follow_up(
        db, case, days_from_now=-1,
        reason="Urgent concern disclosed — immediate follow-up",
    )
    scheduler.sweep(db, now=NOW)
    db.refresh(row)
    assert row.status == "DUE"


@pytest.mark.parametrize(
    "reason,expected",
    [
        # Real reason strings now carry the predicted interval, so the parser must
        # still recover the band from the prefix.
        ("Urgent concern disclosed — immediate follow-up (predicted 12h)", 2),
        ("Critical risk — next-day follow-up (predicted 1d)", 2),
        ("High risk — early follow-up (predicted 2d 6h)", 3),
        ("High risk — early follow-up (predicted 1d, escalating trajectory)", 3),
        ("Elevated indicators — closer monitoring (predicted 5d)", 7),
        ("Routine monitoring (predicted 14d, capped by band)", 7),
        ("Routine monitoring", 7),
        ("", 7),
    ],
)
def test_grace_days_by_reason(reason, expected):
    assert scheduler.grace_days(reason) == expected


def test_counsellor_set_calls_get_a_short_grace_period():
    """They picked that time for a reason, so silence is worth surfacing fast."""
    assert scheduler.grace_days("Scheduled by counsellor", "COUNSELLOR") == 2
    # Source wins over the reason prefix.
    assert scheduler.grace_days("Routine monitoring", "COUNSELLOR") == 2


def test_long_overdue_goes_scheduled_to_missed_in_one_sweep(db, case):
    """After downtime, one sweep must fully catch up."""
    row = add_follow_up(db, case, days_from_now=-30, reason="Routine monitoring")
    result = scheduler.sweep(db, now=NOW)
    db.refresh(row)
    assert row.status == "MISSED"
    assert result.became_due == 1
    assert result.became_missed == 1


# --------------------------------------------------------------------------
# idempotence
# --------------------------------------------------------------------------

def test_sweep_is_idempotent(db, case):
    add_follow_up(db, case, days_from_now=-1)
    first = scheduler.sweep(db, now=NOW)
    second = scheduler.sweep(db, now=NOW)
    assert first.changed == 1
    assert second.changed == 0


def test_completed_and_cancelled_rows_are_never_touched(db, case):
    done = add_follow_up(db, case, days_from_now=-20, status="COMPLETED")
    cancelled = add_follow_up(db, case, days_from_now=-20, status="CANCELLED")
    scheduler.sweep(db, now=NOW)
    db.refresh(done)
    db.refresh(cancelled)
    assert done.status == "COMPLETED"
    assert cancelled.status == "CANCELLED"


# --------------------------------------------------------------------------
# audit trail
# --------------------------------------------------------------------------

def test_transitions_write_workflow_events(db, case):
    add_follow_up(db, case, days_from_now=-30, reason="Routine monitoring")
    scheduler.sweep(db, now=NOW)

    events = db.scalars(
        select(WorkflowEvent).where(WorkflowEvent.node == "schedule")
    ).all()
    transitions = [(e.from_state, e.to_state) for e in events]
    assert ("SCHEDULED", "DUE") in transitions
    assert ("DUE", "MISSED") in transitions


# --------------------------------------------------------------------------
# completion by a real check-in
# --------------------------------------------------------------------------

def test_completing_closes_the_earliest_outstanding_follow_up(db, case):
    older = add_follow_up(db, case, days_from_now=-4)
    newer = add_follow_up(db, case, days_from_now=2)

    closed = scheduler.complete_for_case(db, case_id=case.id, interaction_id=99, now=NOW)
    db.refresh(older)
    db.refresh(newer)

    assert closed is not None
    assert closed.id == older.id
    assert older.status == "COMPLETED"
    assert older.completed_interaction_id == 99
    assert newer.status == "SCHEDULED"


def test_completing_with_nothing_outstanding_is_not_an_error(db, case):
    assert scheduler.complete_for_case(db, case_id=case.id, interaction_id=1, now=NOW) is None


def test_completion_writes_an_event(db, case):
    add_follow_up(db, case, days_from_now=-1, status="DUE")
    scheduler.complete_for_case(db, case_id=case.id, interaction_id=7, now=NOW)
    events = db.scalars(
        select(WorkflowEvent).where(WorkflowEvent.to_state == "COMPLETED")
    ).all()
    assert len(events) == 1


# --------------------------------------------------------------------------
# case isolation — contract rule 5
# --------------------------------------------------------------------------

def test_completion_never_touches_another_case(db, case):
    other_user = User(uid="u-test-2", display_name="Other Person")
    db.add(other_user)
    db.flush()
    other_case = Case(user_id=other_user.id, case_ref="VIORA-TEST-2", status="ACTIVE")
    db.add(other_case)
    db.commit()

    mine = add_follow_up(db, case, days_from_now=-1)
    theirs = add_follow_up(db, other_case, days_from_now=-5)

    scheduler.complete_for_case(db, case_id=case.id, interaction_id=1, now=NOW)
    db.refresh(mine)
    db.refresh(theirs)
    assert mine.status == "COMPLETED"
    assert theirs.status == "SCHEDULED"


# --------------------------------------------------------------------------
# due_now
# --------------------------------------------------------------------------

def test_due_now_returns_overdue_first_and_excludes_future(db, case):
    add_follow_up(db, case, days_from_now=5)
    mid = add_follow_up(db, case, days_from_now=-1)
    oldest = add_follow_up(db, case, days_from_now=-6)

    rows = scheduler.due_now(db, now=NOW)
    assert [r.id for r in rows] == [oldest.id, mid.id]


# --------------------------------------------------------------------------
# counsellor-set call times — AI recommends, human decides
# --------------------------------------------------------------------------

def test_counsellor_can_set_the_next_call_time(db, case):
    when = NOW + timedelta(days=2, hours=3)
    row = scheduler.schedule_manual(
        db, case_id=case.id, scheduled_for=when, channel="VOICE",
        staff_id=1, note="Court date Thursday", now=NOW,
    )
    assert row.source == "COUNSELLOR"
    assert row.scheduled_for == when
    assert row.channel == "VOICE"
    assert row.scheduled_by_staff_id == 1
    assert row.staff_note == "Court date Thursday"
    assert row.status == "SCHEDULED"


def test_manual_scheduling_cancels_the_prediction_rather_than_deleting_it(db, case):
    """The audit must keep what was predicted AND what the human chose."""
    predicted = add_follow_up(db, case, days_from_now=7)
    scheduler.schedule_manual(
        db, case_id=case.id, scheduled_for=NOW + timedelta(days=1),
        channel="VOICE", staff_id=1, now=NOW,
    )
    db.refresh(predicted)
    assert predicted.status == "CANCELLED"
    assert db.get(FollowUp, predicted.id) is not None


def test_only_one_follow_up_is_outstanding_after_an_override(db, case):
    add_follow_up(db, case, days_from_now=3)
    add_follow_up(db, case, days_from_now=9)
    scheduler.schedule_manual(
        db, case_id=case.id, scheduled_for=NOW + timedelta(days=1),
        channel="VOICE", staff_id=1, now=NOW,
    )
    outstanding = db.scalars(
        select(FollowUp).where(
            FollowUp.case_id == case.id, FollowUp.status.in_(("SCHEDULED", "DUE"))
        )
    ).all()
    assert len(outstanding) == 1
    assert outstanding[0].source == "COUNSELLOR"


def test_manual_scheduling_never_touches_another_case(db, case):
    other_user = User(uid="u-test-3", display_name="Third Person")
    db.add(other_user)
    db.flush()
    other_case = Case(user_id=other_user.id, case_ref="VIORA-TEST-3", status="ACTIVE")
    db.add(other_case)
    db.commit()

    theirs = add_follow_up(db, other_case, days_from_now=4)
    scheduler.schedule_manual(
        db, case_id=case.id, scheduled_for=NOW + timedelta(days=1),
        channel="VOICE", staff_id=1, now=NOW,
    )
    db.refresh(theirs)
    assert theirs.status == "SCHEDULED"


def test_a_counsellor_set_call_becomes_due_on_time(db, case):
    """The whole demo hinges on this: set a time, the call comes due."""
    scheduler.schedule_manual(
        db, case_id=case.id, scheduled_for=NOW + timedelta(hours=1),
        channel="VOICE", staff_id=1, now=NOW,
    )
    # Before the time: nothing due.
    assert scheduler.due_now(db, now=NOW) == []

    # After it: due.
    later = NOW + timedelta(hours=2)
    scheduler.sweep(db, now=later)
    rows = scheduler.due_now(db, now=later)
    assert len(rows) == 1
    assert rows[0].status == "DUE"
    assert rows[0].source == "COUNSELLOR"


def test_manual_scheduling_writes_an_event(db, case):
    scheduler.schedule_manual(
        db, case_id=case.id, scheduled_for=NOW + timedelta(days=1),
        channel="VOICE", staff_id=1, now=NOW,
    )
    events = db.scalars(
        select(WorkflowEvent).where(WorkflowEvent.node == "schedule")
    ).all()
    assert any(e.to_state == "SCHEDULED" for e in events)
