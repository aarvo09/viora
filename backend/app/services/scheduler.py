"""Follow-up scheduler — the process that makes a scheduled check-in actually due.

`assessment.py` writes FollowUp rows with a `scheduled_for` date; without this
module nothing ever transitions them, so a caseworker's "due today" list stays
empty and a 1-day URGENT follow-up looks identical to a 14-day routine one.

Two transitions, both deliberately conservative:

    SCHEDULED → DUE      when scheduled_for has passed
    DUE       → MISSED   when it has been due for longer than the grace period

What this module does NOT do:

  * It does not contact anyone. There is no push delivery in this build, and a
    scheduler that silently "notified" a person who never got a message would be
    worse than one that plainly marks work as outstanding.
  * It does not close a follow-up. Only a real completed interaction does that,
    via `complete_for_case`.
  * It does not touch reports, scores or bands. It moves workflow state only.

Grace period reasoning: a person who does not answer on the day is not a missed
follow-up, they are a person who had a hard day. Marking MISSED too early turns
an ordinary delay into a red flag on their record. The window scales with the
urgency of the original schedule — a next-day URGENT check-in that goes
unanswered for two days matters far more than a 14-day routine one running late.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import FollowUp, WorkflowEvent

logger = logging.getLogger(__name__)

SCHEDULER_VERSION = "1.0.0"

# Bounds on a slot the person picks for themselves. Mirrored in the patient app's
# `src/lib/schedule.ts` so the phone can refuse a bad slot without a round trip —
# but this side is the one that decides, because the phone's clock, timezone and
# build are all outside our control.
MIN_LEAD_MINUTES = 15
MAX_LEAD_DAYS = 60

_CLOCK_RE = re.compile(r"^(\d{1,2}):(\d{2})$")

# How long a follow-up may sit DUE before it is treated as missed. Keyed by the
# urgency implied by the original schedule, not by the current risk band: this
# runs without loading reports, and the reason string already carries the band.
GRACE_DAYS_DEFAULT = 7
GRACE_DAYS_BY_URGENCY: dict[str, int] = {
    "URGENT": 2,
    "CRITICAL": 2,
    "HIGH": 3,
}


@dataclass(slots=True)
class SweepResult:
    """What one sweep changed. Returned so the caller can log or surface it."""

    became_due: int = 0
    became_missed: int = 0
    checked: int = 0

    @property
    def changed(self) -> int:
        return self.became_due + self.became_missed


# A counsellor-set call gets a short grace window regardless of band: they picked
# that time for a reason, so it going unanswered is worth surfacing quickly.
GRACE_DAYS_MANUAL = 2


def _urgency_from_reason(reason: str) -> str:
    """Recover the band from the follow-up reason written by the graph.

    The reason strings come from `graph._followup_reason`, so this is reading our
    own output, not parsing free text. Unknown shapes fall through to the default
    grace period rather than raising.
    """
    lowered = (reason or "").lower()
    if lowered.startswith("urgent"):
        return "URGENT"
    if lowered.startswith("critical"):
        return "CRITICAL"
    if lowered.startswith("high"):
        return "HIGH"
    return "DEFAULT"


def grace_days(reason: str, source: str = "PREDICTED") -> int:
    if source == "COUNSELLOR":
        return GRACE_DAYS_MANUAL
    return GRACE_DAYS_BY_URGENCY.get(_urgency_from_reason(reason), GRACE_DAYS_DEFAULT)


def _event(db: Session, follow_up: FollowUp, from_state: str, to_state: str) -> None:
    db.add(
        WorkflowEvent(
            case_id=follow_up.case_id,
            interaction_id=None,
            node="schedule",
            from_state=from_state,
            to_state=to_state,
            payload={
                "follow_up_id": follow_up.id,
                "scheduled_for": follow_up.scheduled_for.isoformat(),
                "scheduler_version": SCHEDULER_VERSION,
            },
        )
    )


def sweep(db: Session, *, now: datetime | None = None) -> SweepResult:
    """Advance follow-up states. Idempotent: running it twice changes nothing new.

    `now` is injected so this is testable and so a sweep can be replayed against
    a fixed clock.
    """
    now = now or datetime.now(timezone.utc)
    result = SweepResult()

    rows = db.scalars(
        select(FollowUp)
        .where(FollowUp.status.in_(("SCHEDULED", "DUE")))
        .order_by(FollowUp.scheduled_for.asc())
    ).all()
    result.checked = len(rows)

    for row in rows:
        # Aware UTC guaranteed by the UTCDateTime column type, so this compares
        # against the injected `now` without any per-site normalisation.
        scheduled = row.scheduled_for

        if row.status == "SCHEDULED" and scheduled <= now:
            row.status = "DUE"
            _event(db, row, "SCHEDULED", "DUE")
            result.became_due += 1
            # Fall through: a long-overdue row can go SCHEDULED → DUE → MISSED
            # in a single sweep, which is what should happen after downtime.

        if row.status == "DUE":
            deadline = scheduled + timedelta(
                days=grace_days(row.reason, row.source or "PREDICTED")
            )
            if now > deadline:
                row.status = "MISSED"
                _event(db, row, "DUE", "MISSED")
                result.became_missed += 1

    if result.changed:
        db.commit()
        logger.info(
            "follow-up sweep: due=%s missed=%s of %s open",
            result.became_due, result.became_missed, result.checked,
        )

    return result


def schedule_manual(
    db: Session,
    *,
    case_id: int,
    scheduled_for: datetime,
    channel: str,
    staff_id: int,
    note: str | None = None,
    now: datetime | None = None,
) -> FollowUp:
    """A counsellor sets the time for the next AI call, overriding the prediction.

    Contract §6 gives the AI the recommendation and the human the decision; this
    is that decision for scheduling. The predicted row is CANCELLED rather than
    deleted, so the audit trail keeps both what was predicted and what a person
    chose instead.

    `source='COUNSELLOR'` is what stops a later prediction from quietly
    overwriting this: nothing in the pipeline replaces a human-set date.
    """
    now = now or datetime.now(timezone.utc)

    superseded = db.scalars(
        select(FollowUp)
        .where(FollowUp.case_id == case_id, FollowUp.status.in_(("SCHEDULED", "DUE")))
        .order_by(FollowUp.scheduled_for.asc())
    ).all()
    for row in superseded:
        previous = row.status
        row.status = "CANCELLED"
        _event(db, row, previous, "CANCELLED")

    manual = FollowUp(
        case_id=case_id,
        scheduled_for=scheduled_for,
        channel=channel,
        status="SCHEDULED",
        reason="Scheduled by counsellor",
        policy_version="manual",
        source="COUNSELLOR",
        scheduled_by_staff_id=staff_id,
        staff_note=note,
        created_at=now,
    )
    db.add(manual)
    db.flush()
    _event(db, manual, None, "SCHEDULED")
    db.commit()
    db.refresh(manual)

    logger.info(
        "manual follow-up scheduled case=%s follow_up=%s staff=%s superseded=%s",
        case_id, manual.id, staff_id, len(superseded),
    )
    return manual


def complete_for_case(
    db: Session, *, case_id: int, interaction_id: int, now: datetime | None = None
) -> FollowUp | None:
    """Close the earliest outstanding follow-up for a case after a real check-in.

    Called when an interaction completes: the person answered, so whatever was
    outstanding is satisfied. Returns the row that was closed, or None if the
    case had nothing outstanding (an unprompted check-in — normal, not an error).
    """
    now = now or datetime.now(timezone.utc)

    row = db.scalars(
        select(FollowUp)
        .where(FollowUp.case_id == case_id, FollowUp.status.in_(("SCHEDULED", "DUE")))
        .order_by(FollowUp.scheduled_for.asc())
    ).first()
    if row is None:
        return None

    previous = row.status
    row.status = "COMPLETED"
    row.completed_interaction_id = interaction_id
    _event(db, row, previous, "COMPLETED")
    db.commit()
    db.refresh(row)

    logger.info("follow-up completed case=%s follow_up=%s", case_id, row.id)
    return row


def due_now(db: Session, *, now: datetime | None = None) -> list[FollowUp]:
    """Follow-ups a caseworker should act on today, most overdue first.

    Read-only — call `sweep()` first if you want states advanced.
    """
    now = now or datetime.now(timezone.utc)
    return list(
        db.scalars(
            select(FollowUp)
            .where(
                FollowUp.status.in_(("SCHEDULED", "DUE")),
                FollowUp.scheduled_for <= now,
            )
            .order_by(FollowUp.scheduled_for.asc())
        ).all()
    )


__all__ = [
    "SCHEDULER_VERSION",
    "SweepResult",
    "grace_days",
    "sweep",
    "schedule_manual",
    "complete_for_case",
    "due_now",
    "MIN_LEAD_MINUTES",
    "MAX_LEAD_DAYS",
    "parse_clock",
    "within_window",
    "validate_patient_slot",
    "schedule_patient",
    "cancel_outstanding",
]


# ------------------------------------------------ patient-chosen slots ----
#
# The safe-contact window is not a preference. For someone whose abuser may be
# in the house, "call me between 10 and 5" means "those are the hours I am
# alone", so a check-in outside it can put a person in danger. Until now nothing
# enforced it: `safe_contact_start`/`_end` have been on the model since the first
# migration, but only `seed.py` wrote them and only the counsellor view read
# them, for display. A predicted follow-up could land at 3am and nothing
# objected. These functions are that missing guard.


def parse_clock(value: str) -> int | None:
    """"HH:MM" → minutes since midnight, or None when malformed."""
    match = _CLOCK_RE.match((value or "").strip())
    if match is None:
        return None
    hours, minutes = int(match.group(1)), int(match.group(2))
    if hours > 23 or minutes > 59:
        return None
    return hours * 60 + minutes


def within_window(minutes: int, start: str, end: str) -> bool:
    """Is `minutes` (since local midnight) inside the safe-contact window?

    A window that wraps past midnight (22:00 → 06:00) is a union of two ranges.
    No seeded profile uses one, but a night-shift worker's safe hours look
    exactly like that, and silently refusing every slot would be a confusing way
    to discover it.

    An unusable or zero-width window returns True. Refusing every possible time
    because a stored string is malformed would lock the person out of scheduling
    entirely, which is a worse failure than accepting a slot we could not check.
    """
    begin = parse_clock(start)
    finish = parse_clock(end)
    if begin is None or finish is None:
        return True
    if begin == finish:
        return True
    if begin < finish:
        return begin <= minutes <= finish
    return minutes >= begin or minutes <= finish


def validate_patient_slot(
    *,
    when: datetime,
    now: datetime,
    safe_start: str,
    safe_end: str,
    tz: str,
) -> str | None:
    """Check a slot the person picked. Returns None when fine, else a reason
    phrased for the person rather than for a log.

    The window is checked in the PERSON'S timezone, not the server's and not the
    phone's. `when` arrives as UTC from the wire; "is this inside 10:00–17:00"
    is a question about the clock on their wall.
    """
    if when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc)

    lead = when - now
    if lead.total_seconds() <= 0:
        return "Please choose a time in the future."
    if lead < timedelta(minutes=MIN_LEAD_MINUTES):
        return f"Please choose a time at least {MIN_LEAD_MINUTES} minutes from now."
    if lead > timedelta(days=MAX_LEAD_DAYS):
        return f"Please choose a time within the next {MAX_LEAD_DAYS} days."

    try:
        local = when.astimezone(ZoneInfo(tz or "Asia/Kolkata"))
    except (ZoneInfoNotFoundError, ValueError):
        # A bad stored timezone must not block the person from scheduling; fall
        # back to the slot as sent rather than refusing outright.
        local = when

    minutes = local.hour * 60 + local.minute
    if not within_window(minutes, safe_start, safe_end):
        return (
            f"Your safe hours are {safe_start} to {safe_end}. "
            "Please pick a time in that range."
        )
    return None


def schedule_patient(
    db: Session,
    *,
    case_id: int,
    scheduled_for: datetime,
    channel: str,
    now: datetime | None = None,
) -> FollowUp:
    """The person moves their own next check-in.

    `source='PATIENT'` is a third source alongside PREDICTED and COUNSELLOR, and
    it exists so the dashboard can tell the three apart. A person choosing a
    different hour is not the pipeline overwriting a caseworker's decision — it
    is the one party who knows when they are actually safe to talk. The
    superseded row is CANCELLED rather than deleted, so a caseworker looking at
    the case still sees that the time moved, and what it moved from.
    """
    now = now or datetime.now(timezone.utc)

    superseded = db.scalars(
        select(FollowUp)
        .where(FollowUp.case_id == case_id, FollowUp.status.in_(("SCHEDULED", "DUE")))
        .order_by(FollowUp.scheduled_for.asc())
    ).all()
    for row in superseded:
        previous = row.status
        row.status = "CANCELLED"
        _event(db, row, previous, "CANCELLED")

    chosen = FollowUp(
        case_id=case_id,
        scheduled_for=scheduled_for,
        channel=channel,
        status="SCHEDULED",
        reason="Chosen by the person",
        policy_version="patient",
        source="PATIENT",
        created_at=now,
    )
    db.add(chosen)
    db.flush()
    _event(db, chosen, None, "SCHEDULED")
    db.commit()
    db.refresh(chosen)

    logger.info(
        "patient follow-up scheduled case=%s follow_up=%s superseded=%s",
        case_id, chosen.id, len(superseded),
    )
    return chosen


def cancel_outstanding(db: Session, *, case_id: int) -> int:
    """Cancel every outstanding follow-up for a case. Returns how many.

    Used when the person clears their own check-in. The caller decides whether
    they are allowed to — this only performs the transition.
    """
    rows = db.scalars(
        select(FollowUp)
        .where(FollowUp.case_id == case_id, FollowUp.status.in_(("SCHEDULED", "DUE")))
    ).all()
    for row in rows:
        previous = row.status
        row.status = "CANCELLED"
        _event(db, row, previous, "CANCELLED")
    if rows:
        db.commit()
    logger.info("patient cancelled follow-ups case=%s count=%s", case_id, len(rows))
    return len(rows)
