"""VIORA ORM models — the single source of truth. See docs/CONTRACT.md §8.

Chain:
    User → Case → Interaction → ConversationMessage
                              → InteractionAnalysis
                              → Report → RiskAssessment
                                       → RiskPrediction
                                       → Alert → HumanReview → Intervention
                              → FollowUp
                              → WorkflowEvent   (audit trail)

APPEND-ONLY tables (contract rule 3): Report, InteractionAnalysis,
RiskAssessment, RiskPrediction, WorkflowEvent. Never UPDATE these rows and never
recompute history with current values — a new assessment is a new row with an
incremented report_version.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from sqlalchemy import (
    Boolean,
    Float,
    ForeignKey,
    Index,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base, UTCDateTime, utcnow

# --------------------------------------------------------------------------
# Controlled vocabularies. Stored as strings for SQLite/Alembic simplicity;
# validated at the Pydantic schema layer, not by the DB.
# --------------------------------------------------------------------------

CHANNELS = ("VOICE", "TEXT")
MESSAGE_ROLES = ("USER", "VIORA")
RISK_LEVELS = ("LOW", "MODERATE", "HIGH", "CRITICAL", "URGENT")
TRENDS = ("IMPROVING", "STABLE", "WORSENING", "INSUFFICIENT_DATA")
DIRECTIONS = ("DE_ESCALATING", "STABLE", "ESCALATING", "INSUFFICIENT_DATA")
BASELINE_CONFIDENCE = ("NONE", "LOW", "MEDIUM", "HIGH")
STAFF_ROLES = ("DSWO", "DM", "SP", "SPP", "ADMIN")
INTERACTION_STATUS = ("IN_PROGRESS", "COMPLETED", "ABANDONED")
ALERT_STATUS = ("OPEN", "ACKNOWLEDGED", "CLOSED")
REVIEW_OUTCOMES = ("CONTINUE_MONITORING", "INTERVENTION_REQUIRED", "ESCALATE", "CLOSED")
INTERVENTION_TYPES = (
    "PSYCH_SUPPORT",
    "POLICE_PROTECTION",
    "RELOCATION",
    "LEGAL_AID",
    "MEDICAL",
    "COMPENSATION_FOLLOWUP",
)
FOLLOWUP_STATUS = ("SCHEDULED", "DUE", "COMPLETED", "MISSED", "CANCELLED")
CASE_STATUS = ("ACTIVE", "MONITORING", "CLOSED")


class User(Base):
    """A person receiving support. Identified to staff by anonymous UID."""

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    uid: Mapped[str] = mapped_column(String(32), unique=True, index=True, nullable=False)
    display_name: Mapped[str] = mapped_column(String(120), nullable=False)
    preferred_language: Mapped[str] = mapped_column(String(8), default="hi", nullable=False)
    preferred_channel: Mapped[str] = mapped_column(String(16), default="TEXT", nullable=False)
    safe_contact_start: Mapped[str] = mapped_column(String(5), default="10:00", nullable=False)
    safe_contact_end: Mapped[str] = mapped_column(String(5), default="18:00", nullable=False)
    timezone: Mapped[str] = mapped_column(String(64), default="Asia/Kolkata", nullable=False)

    # INTERNAL ONLY. Never rendered in any UI, always excluded from aggregates.
    # Contract §8. These are ordinary-looking accounts for controlled testing.
    is_controlled_test: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)

    cases: Mapped[list["Case"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    consents: Mapped[list["Consent"]] = relationship(back_populates="user", cascade="all, delete-orphan")


class Consent(Base):
    __tablename__ = "consents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    version: Mapped[str] = mapped_column(String(16), default="1.0.0", nullable=False)
    # Audio is discarded after transcription unless this is explicitly true.
    audio_retention_opt_in: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    granted_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)
    revoked_at: Mapped[Optional[datetime]] = mapped_column(UTCDateTime(), nullable=True)

    user: Mapped["User"] = relationship(back_populates="consents")


class StaffUser(Base):
    """Counsellor / caseworker. Role exists from day one so real RBAC is additive."""

    __tablename__ = "staff_users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(16), default="DSWO", nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)


class Case(Base):
    __tablename__ = "cases"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    case_ref: Mapped[str] = mapped_column(String(32), unique=True, index=True, nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="ACTIVE", nullable=False)
    # Single field rather than a legal-timeline module for this build.
    legal_stage: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    assigned_staff_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("staff_users.id", ondelete="SET NULL"), nullable=True
    )
    opened_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)

    user: Mapped["User"] = relationship(back_populates="cases")
    interactions: Mapped[list["Interaction"]] = relationship(
        back_populates="case", cascade="all, delete-orphan"
    )
    reports: Mapped[list["Report"]] = relationship(
        back_populates="case", cascade="all, delete-orphan"
    )


class Interaction(Base):
    __tablename__ = "interactions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    case_id: Mapped[int] = mapped_column(
        ForeignKey("cases.id", ondelete="CASCADE"), index=True, nullable=False
    )
    channel: Mapped[str] = mapped_column(String(16), default="TEXT", nullable=False)
    language: Mapped[str] = mapped_column(String(8), default="hi", nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="IN_PROGRESS", nullable=False)
    turn_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    started_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)
    ended_at: Mapped[Optional[datetime]] = mapped_column(UTCDateTime(), nullable=True)

    case: Mapped["Case"] = relationship(back_populates="interactions")
    messages: Mapped[list["ConversationMessage"]] = relationship(
        back_populates="interaction", cascade="all, delete-orphan", order_by="ConversationMessage.seq"
    )


class ConversationMessage(Base):
    __tablename__ = "conversation_messages"
    __table_args__ = (UniqueConstraint("interaction_id", "seq", name="uq_message_seq"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    interaction_id: Mapped[int] = mapped_column(
        ForeignKey("interactions.id", ondelete="CASCADE"), index=True, nullable=False
    )
    seq: Mapped[int] = mapped_column(Integer, nullable=False)
    role: Mapped[str] = mapped_column(String(8), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)

    interaction: Mapped["Interaction"] = relationship(back_populates="messages")


class InteractionAnalysis(Base):
    """APPEND-ONLY. Raw extracted signals, contract §1."""

    __tablename__ = "interaction_analyses"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    interaction_id: Mapped[int] = mapped_column(
        ForeignKey("interactions.id", ondelete="CASCADE"), index=True, nullable=False
    )
    signals: Mapped[Any] = mapped_column(JSON, nullable=False)
    schema_version: Mapped[str] = mapped_column(String(16), default="1.0.0", nullable=False)
    model_id: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)


class Report(Base):
    """APPEND-ONLY, versioned per case. Contract §8.

    signals_snapshot and factors freeze the state at the time of assessment so a
    historical report never has to be recomputed.
    """

    __tablename__ = "reports"
    __table_args__ = (
        UniqueConstraint("case_id", "report_version", name="uq_report_case_version"),
        Index("ix_reports_case_created", "case_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    case_id: Mapped[int] = mapped_column(
        ForeignKey("cases.id", ondelete="CASCADE"), index=True, nullable=False
    )
    interaction_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("interactions.id", ondelete="SET NULL"), index=True, nullable=True
    )
    report_version: Mapped[int] = mapped_column(Integer, nullable=False)

    # Two axes, never merged into one stored band. Contract §2 / §3.
    distress_score: Mapped[float] = mapped_column(Float, nullable=False)
    threat_score: Mapped[float] = mapped_column(Float, nullable=False)
    composite_score: Mapped[float] = mapped_column(Float, nullable=False)
    risk_level: Mapped[str] = mapped_column(String(16), nullable=False)

    baseline_score: Mapped[float] = mapped_column(Float, nullable=False)
    baseline_confidence: Mapped[str] = mapped_column(String(8), nullable=False)
    previous_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    score_change: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    baseline_deviation: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    trend: Mapped[str] = mapped_column(String(24), nullable=False)

    signals_snapshot: Mapped[Any] = mapped_column(JSON, nullable=False)
    factors: Mapped[Any] = mapped_column(JSON, nullable=False)
    conversation_summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    scoring_version: Mapped[str] = mapped_column(String(16), default="1.0.0", nullable=False)

    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)

    case: Mapped["Case"] = relationship(back_populates="reports")


class RiskAssessment(Base):
    """APPEND-ONLY. Current-state risk at a point in time."""

    __tablename__ = "risk_assessments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    case_id: Mapped[int] = mapped_column(
        ForeignKey("cases.id", ondelete="CASCADE"), index=True, nullable=False
    )
    report_id: Mapped[int] = mapped_column(
        ForeignKey("reports.id", ondelete="CASCADE"), index=True, nullable=False
    )
    risk_level: Mapped[str] = mapped_column(String(16), nullable=False)
    distress_score: Mapped[float] = mapped_column(Float, nullable=False)
    threat_score: Mapped[float] = mapped_column(Float, nullable=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)


class RiskPrediction(Base):
    """APPEND-ONLY. Trajectory, deliberately separate from current state."""

    __tablename__ = "risk_predictions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    case_id: Mapped[int] = mapped_column(
        ForeignKey("cases.id", ondelete="CASCADE"), index=True, nullable=False
    )
    report_id: Mapped[int] = mapped_column(
        ForeignKey("reports.id", ondelete="CASCADE"), index=True, nullable=False
    )
    direction: Mapped[str] = mapped_column(String(24), nullable=False)
    escalation_risk: Mapped[float] = mapped_column(Float, nullable=False)
    horizon: Mapped[str] = mapped_column(String(32), default="NEXT_2_CHECKINS", nullable=False)
    factors: Mapped[Any] = mapped_column(JSON, nullable=False)
    model_version: Mapped[str] = mapped_column(String(16), default="1.0.0", nullable=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)


class Alert(Base):
    __tablename__ = "alerts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    case_id: Mapped[int] = mapped_column(
        ForeignKey("cases.id", ondelete="CASCADE"), index=True, nullable=False
    )
    # Nullable: an URGENT alert is written mid-interaction, before any report
    # exists. Contract §6 / §7.
    report_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("reports.id", ondelete="SET NULL"), nullable=True
    )
    interaction_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("interactions.id", ondelete="SET NULL"), nullable=True
    )
    severity: Mapped[str] = mapped_column(String(16), nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="OPEN", nullable=False)
    factors: Mapped[Any] = mapped_column(JSON, nullable=False)
    acknowledged_by: Mapped[Optional[int]] = mapped_column(
        ForeignKey("staff_users.id", ondelete="SET NULL"), nullable=True
    )
    acknowledged_at: Mapped[Optional[datetime]] = mapped_column(UTCDateTime(), nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)


class HumanReview(Base):
    """The counsellor's decision. AI recommends; this record decides."""

    __tablename__ = "human_reviews"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    case_id: Mapped[int] = mapped_column(
        ForeignKey("cases.id", ondelete="CASCADE"), index=True, nullable=False
    )
    alert_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("alerts.id", ondelete="SET NULL"), nullable=True
    )
    staff_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("staff_users.id", ondelete="SET NULL"), nullable=True
    )
    outcome: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)
    decided_at: Mapped[Optional[datetime]] = mapped_column(UTCDateTime(), nullable=True)


class Intervention(Base):
    __tablename__ = "interventions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    case_id: Mapped[int] = mapped_column(
        ForeignKey("cases.id", ondelete="CASCADE"), index=True, nullable=False
    )
    review_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("human_reviews.id", ondelete="SET NULL"), nullable=True
    )
    type: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="OPEN", nullable=False)
    staff_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("staff_users.id", ondelete="SET NULL"), nullable=True
    )
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)


class FollowUp(Base):
    """The next check-in. Interval is PREDICTED per conversation, not per band.

    `cadence_*` records how the date was arrived at, so the dashboard can answer
    "why Thursday?" and a caseworker can override it with `source='COUNSELLOR'`.
    """

    __tablename__ = "follow_ups"
    __table_args__ = (Index("ix_followups_due", "status", "scheduled_for"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    case_id: Mapped[int] = mapped_column(
        ForeignKey("cases.id", ondelete="CASCADE"), index=True, nullable=False
    )
    scheduled_for: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False)
    channel: Mapped[str] = mapped_column(String(16), default="TEXT", nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="SCHEDULED", nullable=False)
    # Derived from the workflow decision, never hand-written prose.
    reason: Mapped[str] = mapped_column(String(255), nullable=False)
    policy_version: Mapped[str] = mapped_column(String(16), default="1.0.0", nullable=False)

    # PREDICTED | COUNSELLOR — who set this date. A counsellor's date is never
    # silently replaced by a prediction.
    source: Mapped[str] = mapped_column(String(16), default="PREDICTED", nullable=False)
    # The predicted interval in hours, and the rules that produced it. Null on a
    # purely manual row.
    cadence_hours: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    cadence_base_hours: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    cadence_factors: Mapped[Optional[Any]] = mapped_column(JSON, nullable=True)
    cadence_version: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)

    # Set when a counsellor overrides, so the audit shows who and why.
    scheduled_by_staff_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("staff_users.id", ondelete="SET NULL"), nullable=True
    )
    staff_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    completed_interaction_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("interactions.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)


class WorkflowEvent(Base):
    """APPEND-ONLY audit trail. Every LangGraph node transition writes one."""

    __tablename__ = "workflow_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    case_id: Mapped[int] = mapped_column(
        ForeignKey("cases.id", ondelete="CASCADE"), index=True, nullable=False
    )
    interaction_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("interactions.id", ondelete="SET NULL"), index=True, nullable=True
    )
    node: Mapped[str] = mapped_column(String(32), nullable=False)
    from_state: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    to_state: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    payload: Mapped[Optional[Any]] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow)


__all__ = [
    "User",
    "Consent",
    "StaffUser",
    "Case",
    "Interaction",
    "ConversationMessage",
    "InteractionAnalysis",
    "Report",
    "RiskAssessment",
    "RiskPrediction",
    "Alert",
    "HumanReview",
    "Intervention",
    "FollowUp",
    "WorkflowEvent",
]
