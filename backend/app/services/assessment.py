"""Assessment persistence — contract §6.

    ingest → extract → score → baseline → risk → predict → explain → decide → persist
    └──────────────── services/graph.py (LangGraph) ────────────────┘  └─ here ─┘

The workflow itself is a LangGraph StateGraph in `services/graph.py`, as contract
§6 requires. This module is the persistence half: it loads the case-scoped
history, hands it to the graph, and writes the graph's output to the database.

This is still the ONLY place a Report is created.

Division of labour, and it matters:

  * `graph.py` orchestrates and calls the pure services. It computes nothing.
  * the pure services compute. They have no database, no clock, no network.
  * this module persists. It does no arithmetic of its own.

So the determinism boundary is unchanged by the move to LangGraph: the graph
threads values between nodes, and every value it threads was produced by a pure
function. `now` is injected by the caller, never read from the wall clock inside
the graph.

Every node emits a WorkflowEvent. That table is the audit trail: for any report
you can reconstruct which node produced which value.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.models import (
    Alert,
    HumanReview,
    FollowUp,
    Interaction,
    InteractionAnalysis,
    Report,
    RiskAssessment,
    RiskPrediction,
    WorkflowEvent,
)
from app.services import cadence as cadence_svc
from app.services import graph as graph_svc
from app.services import risk as risk_svc
from app.services import scoring as scoring_svc
from app.services.graph import ALERTING_BANDS
from app.services.signals import PriorReport

logger = logging.getLogger(__name__)

PIPELINE_VERSION = "1.0.0"


@dataclass(slots=True)
class AssessmentResult:
    report: Report
    risk_level: str
    direction: str
    alert: Alert | None
    follow_up: FollowUp | None


def _event(
    db: Session,
    case_id: int,
    interaction_id: int | None,
    node: str,
    payload: dict[str, Any] | None = None,
    to_state: str | None = None,
) -> None:
    db.add(
        WorkflowEvent(
            case_id=case_id,
            interaction_id=interaction_id,
            node=node,
            to_state=to_state,
            payload=payload,
        )
    )


def _load_priors(db: Session, case_id: int) -> list[PriorReport]:
    """This case's prior reports, oldest first.

    Scoped by case_id — the structural guarantee that one person's history can
    never influence another's baseline (contract rule 5).
    """
    rows = db.scalars(
        select(Report).where(Report.case_id == case_id).order_by(Report.report_version.asc())
    ).all()
    return [
        PriorReport(
            report_version=r.report_version,
            distress_score=r.distress_score,
            threat_score=r.threat_score,
            avg_user_chars=float((r.signals_snapshot or {}).get("engagement", {}).get("avg_user_chars", 0.0)),
        )
        for r in rows
    ]


def _drain_events(
    db: Session, case_id: int, interaction_id: int | None, state: dict[str, Any]
) -> None:
    """Write the graph's recorded node transitions as WorkflowEvent rows.

    The graph deliberately has no database access, so it accumulates event
    descriptions in state and this function persists them — in node order, which
    is what makes the audit trail readable top-to-bottom.
    """
    for event in state.get("events", []):
        _event(
            db,
            case_id,
            interaction_id,
            event["node"],
            event.get("payload"),
            to_state=event.get("to_state"),
        )


def run_assessment(
    db: Session,
    *,
    interaction: Interaction,
    raw_signals: dict[str, Any],
    model_id: str,
    now: datetime | None = None,
) -> AssessmentResult:
    """Run the full pipeline for a completed interaction and persist the result.

    `now` is injected so the caller (and tests) control the clock; the pure
    services never read it at all.
    """
    now = now or datetime.now(timezone.utc)
    case_id = interaction.case_id

    # ---- load case-scoped history ----------------------------------------
    # Scoped by case_id: the structural guarantee that one person's history can
    # never influence another's baseline (contract rule 5).
    priors = _load_priors(db, case_id)

    # ---- run the LangGraph workflow --------------------------------------
    # The graph computes everything and records its node transitions. It has no
    # database access and no clock of its own; `now` is injected here.
    state = graph_svc.run_workflow(
        {
            "raw_signals": raw_signals,
            "priors": priors,
            "now": now,
            "channel": interaction.channel,
        }
    )

    signals = state["signals"]
    factors_json = state["factors"]
    band = state["band"]

    # ---- record the extraction (APPEND ONLY) ------------------------------
    db.add(
        InteractionAnalysis(
            interaction_id=interaction.id,
            signals=raw_signals,
            schema_version=state["schema_version"],
            model_id=model_id,
        )
    )

    _drain_events(db, case_id, interaction.id, state)

    # ---- persist report (APPEND ONLY) -------------------------------------
    report = Report(
        case_id=case_id,
        interaction_id=interaction.id,
        report_version=state["report_version"],
        distress_score=state["distress"],
        threat_score=state["threat"],
        composite_score=state["composite"],
        risk_level=band,
        baseline_score=state["baseline"],
        baseline_confidence=state["baseline_confidence"],
        previous_score=state["previous_score"],
        score_change=state["change"],
        baseline_deviation=state["baseline_deviation"],
        trend=state["trend"],
        signals_snapshot=raw_signals,
        factors=factors_json,
        conversation_summary=signals.summary or None,
        scoring_version=scoring_svc.VERSION,
        created_at=now,
    )
    db.add(report)
    db.flush()  # assign report.id

    db.add(
        RiskAssessment(
            case_id=case_id, report_id=report.id, risk_level=band,
            distress_score=state["distress"], threat_score=state["threat"],
            created_at=now,
        )
    )
    db.add(
        RiskPrediction(
            case_id=case_id, report_id=report.id,
            direction=state["direction"],
            escalation_risk=state["escalation_risk"],
            horizon=state["horizon"],
            factors=factors_json,
            model_version=risk_svc.VERSION,
            created_at=now,
        )
    )

    # ---- decide -----------------------------------------------------------
    alert: Alert | None = None
    if band in ALERTING_BANDS:
        # An URGENT alert may already exist: the conversation layer fires one
        # mid-interaction on a crisis disclosure rather than waiting for the
        # check-in to end (contract §7). Don't duplicate it.
        existing = db.scalars(
            select(Alert).where(
                Alert.interaction_id == interaction.id, Alert.severity == "URGENT"
            )
        ).first()
        if existing is not None:
            existing.report_id = report.id
            alert = existing
        else:
            alert = Alert(
                case_id=case_id,
                report_id=report.id,
                interaction_id=interaction.id,
                severity=band,
                status="OPEN",
                factors=factors_json,
                created_at=now,
            )
            db.add(alert)
        db.flush()
        db.add(HumanReview(case_id=case_id, alert_id=alert.id, created_at=now))

    # Schedule, interval and reason all came from the graph's `decide` node —
    # predicted from this conversation, not read off a per-band table.
    follow_up = FollowUp(
        case_id=case_id,
        scheduled_for=state["follow_up_at"],
        channel=interaction.channel,
        status="SCHEDULED",
        reason=state["follow_up_reason"],
        policy_version=settings.FOLLOWUP_POLICY_VERSION,
        source="PREDICTED",
        cadence_hours=state["cadence_hours"],
        cadence_base_hours=state["cadence_base_hours"],
        cadence_factors=state["cadence_factors"],
        cadence_version=cadence_svc.VERSION,
        created_at=now,
    )
    db.add(follow_up)

    # ---- close out --------------------------------------------------------
    interaction.status = "COMPLETED"
    interaction.ended_at = now
    _event(db, case_id, interaction.id, "persist", {"report_version": report.report_version})

    db.commit()
    db.refresh(report)

    # Identifiers only — never transcript content (contract: privacy).
    logger.info(
        "assessment complete case=%s interaction=%s version=%s band=%s",
        case_id, interaction.id, report.report_version, band,
    )

    return AssessmentResult(
        report=report,
        risk_level=band,
        direction=state["direction"],
        alert=alert,
        follow_up=follow_up,
    )


def raise_urgent_alert(
    db: Session,
    *,
    interaction: Interaction,
    trigger_quote: str,
    now: datetime | None = None,
) -> Alert:
    """Fire an URGENT alert mid-conversation, before the check-in ends.

    Contract §7: a crisis disclosure must not wait for the interaction to
    complete before a human is notified.
    """
    now = now or datetime.now(timezone.utc)

    existing = db.scalars(
        select(Alert).where(Alert.interaction_id == interaction.id, Alert.severity == "URGENT")
    ).first()
    if existing is not None:
        return existing

    alert = Alert(
        case_id=interaction.case_id,
        interaction_id=interaction.id,
        report_id=None,  # no report yet — this is mid-interaction
        severity="URGENT",
        status="OPEN",
        factors=[
            {
                "code": "CRISIS_IN_CONVERSATION",
                "label": "Crisis disclosed during check-in",
                "severity": "SERIOUS",
                "evidence": trigger_quote,
                "value": None,
            }
        ],
        created_at=now,
    )
    db.add(alert)
    db.flush()
    db.add(HumanReview(case_id=interaction.case_id, alert_id=alert.id, created_at=now))
    _event(db, interaction.case_id, interaction.id, "crisis", {"immediate": True}, to_state="URGENT")
    db.commit()
    db.refresh(alert)

    logger.warning(
        "URGENT alert raised mid-interaction case=%s interaction=%s",
        interaction.case_id, interaction.id,
    )
    return alert
