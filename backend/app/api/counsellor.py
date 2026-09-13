"""Counsellor-facing endpoints — contract §9. All require a staff JWT.

Same database, same reports, same transcripts the patient app writes. There is
no second data source: this is what makes patient and counsellor two views of
one case rather than two products.
"""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import (
    ACKNOWLEDGE_ROLES,
    CASEWORK_ROLES,
    ESCALATION_ROLES,
    create_access_token,
    current_staff,
    require_roles,
    verify_password,
)
from app.models import (
    Alert,
    Case,
    ConversationMessage,
    FollowUp,
    HumanReview,
    Interaction,
    Intervention,
    Report,
    RiskPrediction,
    StaffUser,
    User,
)
from app.services import scheduler
from app.schemas import (
    ActivityItem,
    AlertListItem,
    AlertOut,
    CaseDetail,
    CaseListItem,
    DashboardSummary,
    FollowUpOut,
    LoginRequest,
    LoginResponse,
    PredictionOut,
    ReportOut,
    ReviewRequest,
    ReviewResponse,
    RiskDistribution,
    ScheduleCallRequest,
    TelemetryPoint,
    Transcript,
    TranscriptMessage,
)

router = APIRouter(prefix="/api/v1", tags=["counsellor"])


# ----------------------------------------------------------------- auth ----

@router.post("/auth/login", response_model=LoginResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> LoginResponse:
    staff = db.scalars(
        select(StaffUser).where(StaffUser.email == payload.email.lower().strip())
    ).first()
    # Same message either way — never reveal whether an account exists.
    if staff is None or not verify_password(payload.password, staff.password_hash):
        raise HTTPException(401, "Invalid email or password")
    if not staff.is_active:
        raise HTTPException(401, "Invalid email or password")

    return LoginResponse(
        access_token=create_access_token(staff),
        staff_id=staff.id,
        name=staff.name,
        role=staff.role,
    )


# -------------------------------------------------------------- helpers ----

def _latest_report(db: Session, case_id: int) -> Report | None:
    return db.scalars(
        select(Report).where(Report.case_id == case_id).order_by(Report.report_version.desc())
    ).first()


def _latest_prediction(db: Session, case_id: int) -> RiskPrediction | None:
    return db.scalars(
        select(RiskPrediction)
        .where(RiskPrediction.case_id == case_id)
        .order_by(RiskPrediction.created_at.desc())
    ).first()


def _next_follow_up(db: Session, case_id: int) -> FollowUp | None:
    return db.scalars(
        select(FollowUp)
        .where(FollowUp.case_id == case_id, FollowUp.status.in_(("SCHEDULED", "DUE")))
        .order_by(FollowUp.scheduled_for.asc())
    ).first()


def _open_alerts(db: Session, case_id: int) -> list[Alert]:
    return list(
        db.scalars(
            select(Alert)
            .where(Alert.case_id == case_id, Alert.status == "OPEN")
            .order_by(Alert.created_at.desc())
        ).all()
    )


def _case_row(db: Session, case: Case, user: User) -> CaseListItem:
    report = _latest_report(db, case.id)
    prediction = _latest_prediction(db, case.id)
    follow_up = _next_follow_up(db, case.id)
    open_alerts = db.scalar(
        select(func.count(Alert.id)).where(Alert.case_id == case.id, Alert.status == "OPEN")
    )
    return CaseListItem(
        case_id=case.id,
        case_ref=case.case_ref,
        uid=user.uid,
        display_name=user.display_name,
        preferred_language=user.preferred_language,
        status=case.status,
        legal_stage=case.legal_stage,
        risk_level=report.risk_level if report else None,
        distress_score=report.distress_score if report else None,
        threat_score=report.threat_score if report else None,
        trend=report.trend if report else None,
        direction=prediction.direction if prediction else None,
        last_check_in=report.created_at if report else None,
        next_follow_up=follow_up.scheduled_for if follow_up else None,
        open_alerts=int(open_alerts or 0),
    )


RISK_RANK = {"URGENT": 4, "CRITICAL": 3, "HIGH": 2, "MODERATE": 1, "LOW": 0}


# ---------------------------------------------------------------- cases ----

@router.get("/cases", response_model=list[CaseListItem])
def list_cases(
    db: Session = Depends(get_db),
    _: StaffUser = Depends(current_staff),
    risk: str | None = Query(default=None),
    status: str | None = Query(default=None),
) -> list[CaseListItem]:
    stmt = select(Case, User).join(User, Case.user_id == User.id)
    if status:
        stmt = stmt.where(Case.status == status.upper())

    rows = [_case_row(db, case, user) for case, user in db.execute(stmt).all()]
    if risk:
        rows = [r for r in rows if r.risk_level == risk.upper()]

    # Most urgent first, then most recently seen.
    rows.sort(
        key=lambda r: (
            RISK_RANK.get(r.risk_level or "LOW", -1),
            r.last_check_in or datetime.min.replace(tzinfo=timezone.utc),
        ),
        reverse=True,
    )
    return rows


@router.get("/cases/{case_id}", response_model=CaseDetail)
def get_case(
    case_id: int, db: Session = Depends(get_db), _: StaffUser = Depends(current_staff)
) -> CaseDetail:
    """Latest report is included so the case view paints complete on first load."""
    case = db.get(Case, case_id)
    if case is None:
        raise HTTPException(404, "Case not found")
    user = db.get(User, case.user_id)
    if user is None:
        raise HTTPException(404, "Case not found")

    report = _latest_report(db, case_id)
    prediction = _latest_prediction(db, case_id)
    follow_up = _next_follow_up(db, case_id)

    return CaseDetail(
        case_id=case.id,
        case_ref=case.case_ref,
        uid=user.uid,
        display_name=user.display_name,
        preferred_language=user.preferred_language,
        preferred_channel=user.preferred_channel,
        safe_contact_start=user.safe_contact_start,
        safe_contact_end=user.safe_contact_end,
        status=case.status,
        legal_stage=case.legal_stage,
        opened_at=case.opened_at,
        latest_report=ReportOut.model_validate(report) if report else None,
        latest_prediction=PredictionOut.model_validate(prediction) if prediction else None,
        next_follow_up=FollowUpOut.model_validate(follow_up) if follow_up else None,
        open_alerts=[AlertOut.model_validate(a) for a in _open_alerts(db, case_id)],
        report_count=int(
            db.scalar(select(func.count(Report.id)).where(Report.case_id == case_id)) or 0
        ),
        interaction_count=int(
            db.scalar(select(func.count(Interaction.id)).where(Interaction.case_id == case_id)) or 0
        ),
    )


@router.get("/cases/{case_id}/reports", response_model=list[ReportOut])
def list_reports(
    case_id: int, db: Session = Depends(get_db), _: StaffUser = Depends(current_staff)
) -> list[Report]:
    """Every version, newest first. Each row is the state as assessed at that
    time — history is never recomputed with current values."""
    return list(
        db.scalars(
            select(Report)
            .where(Report.case_id == case_id)
            .order_by(Report.report_version.desc())
        ).all()
    )


@router.get("/cases/{case_id}/telemetry", response_model=list[TelemetryPoint])
def get_telemetry(
    case_id: int, db: Session = Depends(get_db), _: StaffUser = Depends(current_staff)
) -> list[TelemetryPoint]:
    reports = db.scalars(
        select(Report).where(Report.case_id == case_id).order_by(Report.report_version.asc())
    ).all()
    predictions = {
        p.report_id: p
        for p in db.scalars(
            select(RiskPrediction).where(RiskPrediction.case_id == case_id)
        ).all()
    }
    return [
        TelemetryPoint(
            report_version=r.report_version,
            created_at=r.created_at,
            distress_score=r.distress_score,
            threat_score=r.threat_score,
            composite_score=r.composite_score,
            baseline_score=r.baseline_score,
            risk_level=r.risk_level,
            direction=predictions[r.id].direction if r.id in predictions else None,
        )
        for r in reports
    ]


@router.get("/cases/{case_id}/follow-ups", response_model=list[FollowUpOut])
def list_follow_ups(
    case_id: int, db: Session = Depends(get_db), _: StaffUser = Depends(current_staff)
) -> list[FollowUp]:
    return list(
        db.scalars(
            select(FollowUp)
            .where(FollowUp.case_id == case_id)
            .order_by(FollowUp.scheduled_for.desc())
        ).all()
    )


@router.post("/cases/{case_id}/schedule-call", response_model=FollowUpOut)
def schedule_call(
    case_id: int,
    payload: ScheduleCallRequest,
    db: Session = Depends(get_db),
    # Scheduling contact is a casework decision.
    staff: StaffUser = Depends(require_roles(*CASEWORK_ROLES)),
) -> FollowUp:
    """Set the time for this person's next AI check-in, overriding the prediction.

    Contract §6 gives the AI the recommendation and the human the decision. The
    predicted follow-up is cancelled, not deleted, so the record shows both what
    was predicted and what a person chose instead — and nothing in the pipeline
    later overwrites a counsellor's time.
    """
    case = db.get(Case, case_id)
    if case is None:
        raise HTTPException(404, "Case not found")

    when = payload.scheduled_for
    if when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc)

    # A time in the past would come due the instant it is written, which is
    # almost always a timezone mistake rather than an intention.
    if when <= datetime.now(timezone.utc):
        raise HTTPException(422, "Scheduled time must be in the future")

    return scheduler.schedule_manual(
        db,
        case_id=case_id,
        scheduled_for=when,
        channel=payload.channel,
        staff_id=staff.id,
        note=payload.note,
    )


@router.get("/follow-ups/due", response_model=list[dict])
def list_due_follow_ups(
    db: Session = Depends(get_db),
    _: StaffUser = Depends(current_staff),
) -> list[dict]:
    """Follow-ups a caseworker should act on now, most overdue first.

    Sweeps first so the list reflects current state rather than whatever the
    background loop last managed — a caseworker opening this page should not see
    stale statuses because the interval had not elapsed.
    """
    scheduler.sweep(db)

    rows = db.execute(
        select(FollowUp, Case, User)
        .join(Case, FollowUp.case_id == Case.id)
        .join(User, Case.user_id == User.id)
        .where(FollowUp.status.in_(("SCHEDULED", "DUE")))
        .order_by(FollowUp.scheduled_for.asc())
    ).all()

    now = datetime.now(timezone.utc)
    out: list[dict] = []
    for follow_up, case, user in rows:
        scheduled = follow_up.scheduled_for
        if scheduled > now:
            continue  # not yet due; the case view shows upcoming ones
        report = _latest_report(db, case.id)
        out.append(
            {
                "follow_up_id": follow_up.id,
                "case_id": case.id,
                "case_ref": case.case_ref,
                "display_name": user.display_name,
                "uid": user.uid,
                "preferred_language": user.preferred_language,
                "scheduled_for": scheduled,
                "days_overdue": (now - scheduled).days,
                "channel": follow_up.channel,
                "status": follow_up.status,
                "reason": follow_up.reason,
                "source": follow_up.source or "PREDICTED",
                "cadence_hours": follow_up.cadence_hours,
                "staff_note": follow_up.staff_note,
                "current_risk": report.risk_level if report else None,
            }
        )
    return out


@router.get("/cases/{case_id}/interactions", response_model=list[dict])
def list_interactions(
    case_id: int, db: Session = Depends(get_db), _: StaffUser = Depends(current_staff)
) -> list[dict]:
    rows = db.scalars(
        select(Interaction)
        .where(Interaction.case_id == case_id)
        .order_by(Interaction.started_at.desc())
    ).all()
    return [
        {
            "interaction_id": i.id,
            "started_at": i.started_at,
            "ended_at": i.ended_at,
            "channel": i.channel,
            "language": i.language,
            "status": i.status,
            "turn_count": i.turn_count,
        }
        for i in rows
    ]


@router.get("/interactions/{interaction_id}/transcript", response_model=Transcript)
def get_transcript(
    interaction_id: int, db: Session = Depends(get_db), _: StaffUser = Depends(current_staff)
) -> Transcript:
    """The actual conversation, chronological, attributed."""
    interaction = db.get(Interaction, interaction_id)
    if interaction is None:
        raise HTTPException(404, "Interaction not found")

    messages = db.scalars(
        select(ConversationMessage)
        .where(ConversationMessage.interaction_id == interaction_id)
        .order_by(ConversationMessage.seq.asc())
    ).all()

    return Transcript(
        interaction_id=interaction.id,
        case_id=interaction.case_id,
        channel=interaction.channel,
        language=interaction.language,
        started_at=interaction.started_at,
        ended_at=interaction.ended_at,
        messages=[
            TranscriptMessage(seq=m.seq, role=m.role, content=m.content, created_at=m.created_at)
            for m in messages
        ],
    )


# --------------------------------------------------------------- alerts ----

@router.get("/alerts", response_model=list[AlertListItem])
def list_alerts(
    db: Session = Depends(get_db),
    _: StaffUser = Depends(current_staff),
    status: str = Query(default="OPEN"),
) -> list[AlertListItem]:
    rows = db.execute(
        select(Alert, Case, User)
        .join(Case, Alert.case_id == Case.id)
        .join(User, Case.user_id == User.id)
        .where(Alert.status == status.upper())
        .order_by(Alert.created_at.desc())
    ).all()

    out: list[AlertListItem] = []
    for alert, case, user in rows:
        report = _latest_report(db, case.id)
        prediction = _latest_prediction(db, case.id)
        out.append(
            AlertListItem(
                id=alert.id,
                case_id=alert.case_id,
                severity=alert.severity,
                status=alert.status,
                factors=alert.factors or [],
                created_at=alert.created_at,
                acknowledged_at=alert.acknowledged_at,
                case_ref=case.case_ref,
                display_name=user.display_name,
                uid=user.uid,
                current_risk=report.risk_level if report else None,
                direction=prediction.direction if prediction else None,
            )
        )
    out.sort(key=lambda a: RISK_RANK.get(a.severity, 0), reverse=True)
    return out


@router.post("/alerts/{alert_id}/acknowledge", response_model=AlertOut)
def acknowledge_alert(
    alert_id: int,
    db: Session = Depends(get_db),
    # Acknowledging is an accountable act: the row records who took ownership.
    # Deliberately wider than casework — police and the magistrate act on danger
    # too — but not open to every role.
    staff: StaffUser = Depends(require_roles(*ACKNOWLEDGE_ROLES)),
) -> Alert:
    alert = db.get(Alert, alert_id)
    if alert is None:
        raise HTTPException(404, "Alert not found")
    alert.status = "ACKNOWLEDGED"
    alert.acknowledged_by = staff.id
    alert.acknowledged_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(alert)
    return alert


# -------------------------------------------------------------- reviews ----

@router.post("/cases/{case_id}/reviews", response_model=ReviewResponse)
def record_review(
    case_id: int,
    payload: ReviewRequest,
    db: Session = Depends(get_db),
    # Recording an outcome is the decision itself — casework roles only.
    staff: StaffUser = Depends(require_roles(*CASEWORK_ROLES)),
) -> ReviewResponse:
    """The counsellor's decision. AI recommends; this is what actually decides."""
    case = db.get(Case, case_id)
    if case is None:
        raise HTTPException(404, "Case not found")

    # ESCALATE reaches beyond casework — police protection, relocation — so it
    # carries its own role gate on top of the endpoint's.
    if payload.outcome == "ESCALATE" and staff.role not in ESCALATION_ROLES:
        raise HTTPException(
            403,
            f"Role {staff.role} may not escalate a case. "
            f"Requires one of: {', '.join(sorted(ESCALATION_ROLES))}.",
        )

    now = datetime.now(timezone.utc)

    # Attach to the oldest pending review if one is waiting, so the alert and
    # the decision stay connected.
    review = db.scalars(
        select(HumanReview)
        .where(HumanReview.case_id == case_id, HumanReview.outcome.is_(None))
        .order_by(HumanReview.created_at.asc())
    ).first()
    if review is None:
        review = HumanReview(case_id=case_id, alert_id=payload.alert_id, created_at=now)
        db.add(review)

    review.staff_id = staff.id
    review.outcome = payload.outcome
    review.notes = payload.notes
    review.decided_at = now

    intervention: Intervention | None = None
    if payload.outcome in ("INTERVENTION_REQUIRED", "ESCALATE"):
        intervention = Intervention(
            case_id=case_id,
            review_id=review.id,
            type=payload.intervention_type or "PSYCH_SUPPORT",
            status="OPEN",
            staff_id=staff.id,
            created_at=now,
        )
        db.add(intervention)

    if payload.outcome == "CLOSED":
        case.status = "CLOSED"

    # Acknowledge the alert this decision resolves.
    if payload.alert_id:
        alert = db.get(Alert, payload.alert_id)
        if alert is not None and alert.status == "OPEN":
            alert.status = "ACKNOWLEDGED"
            alert.acknowledged_by = staff.id
            alert.acknowledged_at = now

    db.flush()
    db.commit()

    return ReviewResponse(
        review_id=review.id,
        outcome=review.outcome,
        decided_at=now,
        intervention_id=intervention.id if intervention else None,
    )


# ------------------------------------------------------------ dashboard ----

@router.get("/dashboard/summary", response_model=DashboardSummary)
def dashboard_summary(
    db: Session = Depends(get_db), _: StaffUser = Depends(current_staff)
) -> DashboardSummary:
    now = datetime.now(timezone.utc)

    rows = [
        _case_row(db, case, user)
        for case, user in db.execute(select(Case, User).join(User, Case.user_id == User.id)).all()
    ]
    active = [r for r in rows if r.status != "CLOSED"]

    distribution = RiskDistribution()
    for row in active:
        if row.risk_level and hasattr(distribution, row.risk_level):
            setattr(distribution, row.risk_level, getattr(distribution, row.risk_level) + 1)

    priority = sorted(
        [r for r in active if RISK_RANK.get(r.risk_level or "LOW", 0) >= 2],
        key=lambda r: RISK_RANK.get(r.risk_level or "LOW", 0),
        reverse=True,
    )[:10]

    open_alerts = int(
        db.scalar(select(func.count(Alert.id)).where(Alert.status == "OPEN")) or 0
    )
    pending_reviews = int(
        db.scalar(select(func.count(HumanReview.id)).where(HumanReview.outcome.is_(None))) or 0
    )
    due = int(
        db.scalar(
            select(func.count(FollowUp.id)).where(
                FollowUp.status.in_(("SCHEDULED", "DUE")), FollowUp.scheduled_for <= now
            )
        )
        or 0
    )

    recent_reports = db.execute(
        select(Report, Case, User)
        .join(Case, Report.case_id == Case.id)
        .join(User, Case.user_id == User.id)
        .order_by(Report.created_at.desc())
        .limit(8)
    ).all()

    activity = [
        ActivityItem(
            case_id=case.id,
            case_ref=case.case_ref,
            display_name=user.display_name,
            kind="CHECK_IN",
            detail=f"Check-in assessed — {report.risk_level}, {report.trend.lower()}",
            at=report.created_at,
        )
        for report, case, user in recent_reports
    ]

    return DashboardSummary(
        active_cases=len(active),
        open_alerts=open_alerts,
        pending_reviews=pending_reviews,
        follow_ups_due=due,
        risk_distribution=distribution,
        priority_cases=priority,
        recent_activity=activity,
    )
