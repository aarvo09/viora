"""Pydantic response/request models — the wire contract (§9).

These shapes are what the OpenAPI schema exposes and what both frontends
generate their typed clients from. Changing a field here changes both apps.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------- auth ----

class LoginRequest(BaseModel):
    email: str
    password: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    staff_id: int
    name: str
    role: str


# ------------------------------------------------------------- patient ----

class PatientProfile(ORMModel):
    """Patient-facing profile. Note what is NOT here: no scores, no risk band,
    no `is_controlled_test`. The patient app never receives clinical framing."""

    uid: str
    display_name: str
    preferred_language: str
    preferred_channel: str
    safe_contact_start: str
    safe_contact_end: str


class WellbeingPoint(BaseModel):
    report_version: int
    created_at: datetime
    distress_score: float
    threat_score: float
    composite_score: float


class PatientWellbeing(BaseModel):
    """Deliberately gentle. The patient sees their own trend, not a risk band —
    telling someone they are 'CRITICAL' is not care."""

    uid: str
    has_history: bool
    latest_check_in: Optional[datetime] = None
    check_in_count: int = 0
    trend: str = "INSUFFICIENT_DATA"
    series: list[WellbeingPoint] = Field(default_factory=list)
    next_follow_up: Optional[datetime] = None
    next_follow_up_channel: Optional[str] = None


class HistoryItem(BaseModel):
    interaction_id: int
    started_at: datetime
    ended_at: Optional[datetime]
    channel: str
    language: str
    status: str
    turn_count: int


class PatientTranscriptMessage(BaseModel):
    seq: int
    role: Literal["USER", "VIORA"]
    content: str
    created_at: datetime


class PatientTranscript(BaseModel):
    """The person's own conversation, read back to them.

    Deliberately not the counsellor's `Transcript`: that one carries `case_id`,
    which is a caseworker's handle on a file and means nothing to the person
    whose conversation it was.
    """

    interaction_id: int
    channel: str
    language: str
    started_at: datetime
    ended_at: Optional[datetime]
    messages: list[PatientTranscriptMessage]


class PatientScheduleRequest(BaseModel):
    """A person choosing when their own next check-in happens."""

    scheduled_for: datetime
    channel: Literal["VOICE", "TEXT"] = "TEXT"


class PatientScheduleResponse(BaseModel):
    """What the person needs to see back. Carries none of `FollowUpOut`'s
    cadence factors or reason string — those name risk bands."""

    scheduled_for: datetime
    channel: str
    status: str


class PreferencesPatch(BaseModel):
    """Preferences the person may change about themselves.

    `display_name` and `uid` are absent on purpose: identity is set at intake by
    a caseworker, and a person renaming their own record would break the handle
    staff use to find them. The safe-contact window IS here — it is the one
    setting only the person can know the right answer to.
    """

    preferred_language: Optional[str] = Field(default=None, max_length=8)
    preferred_channel: Optional[Literal["TEXT", "VOICE"]] = None
    safe_contact_start: Optional[str] = Field(default=None, max_length=5)
    safe_contact_end: Optional[str] = Field(default=None, max_length=5)


# -------------------------------------------------------- conversation ----

class OpenInteractionRequest(BaseModel):
    uid: str
    channel: Literal["VOICE", "TEXT"] = "TEXT"


class OpenInteractionResponse(BaseModel):
    interaction_id: int
    case_id: int
    language: str
    channel: str
    opening_message: str
    opening_audio_b64: Optional[str] = None


class TextTurnRequest(BaseModel):
    text: str


class AudioSentence(BaseModel):
    index: int
    text: str
    audio_b64: Optional[str] = None


class SynthesizeRequest(BaseModel):
    text: str
    language: Optional[str] = "hi"


class SynthesizeResponse(BaseModel):
    sentences: list[AudioSentence] = Field(default_factory=list)


class TurnResponse(BaseModel):
    interaction_id: int
    seq: int
    transcript: Optional[str] = None
    reply_text: str
    sentences: list[AudioSentence] = Field(default_factory=list)
    # True when a crisis was detected this turn and an URGENT alert was raised.
    crisis_detected: bool = False


class CompleteInteractionResponse(BaseModel):
    interaction_id: int
    report_version: int
    # Intentionally minimal: the patient app shows a gentle completion screen,
    # never the risk band or the scores.
    next_follow_up: Optional[datetime] = None
    next_follow_up_channel: Optional[str] = None


class TranscriptMessage(BaseModel):
    seq: int
    role: Literal["USER", "VIORA"]
    content: str
    created_at: datetime


class Transcript(BaseModel):
    interaction_id: int
    case_id: int
    channel: str
    language: str
    started_at: datetime
    ended_at: Optional[datetime]
    messages: list[TranscriptMessage]


# ----------------------------------------------------------- counsellor ----

class FactorOut(BaseModel):
    code: str
    label: str
    severity: Literal["SERIOUS", "CONCERN", "INFO"]
    evidence: str = ""
    value: Optional[float] = None


class ReportOut(ORMModel):
    id: int
    report_version: int
    created_at: datetime
    interaction_id: Optional[int]

    distress_score: float
    threat_score: float
    composite_score: float
    risk_level: str

    baseline_score: float
    baseline_confidence: str
    previous_score: Optional[float]
    score_change: float
    baseline_deviation: float
    trend: str

    factors: list[FactorOut] = Field(default_factory=list)
    conversation_summary: Optional[str] = None
    scoring_version: str


class PredictionOut(ORMModel):
    direction: str
    escalation_risk: float
    horizon: str
    created_at: datetime


class CadenceFactorOut(BaseModel):
    """One rule that moved the predicted interval. `multiplier` < 1 tightened it."""

    code: str
    label: str
    multiplier: float


class FollowUpOut(ORMModel):
    id: int
    scheduled_for: datetime
    channel: str
    status: str
    reason: str
    # PREDICTED | COUNSELLOR — the dashboard renders these differently, because a
    # human-set time is a decision, not a recommendation.
    source: str = "PREDICTED"
    cadence_hours: Optional[float] = None
    cadence_base_hours: Optional[float] = None
    # A counsellor-set follow-up has no predicted interval, so the column is
    # NULL rather than an empty list. Coerce it here: "a human chose this date"
    # and "the prediction fired no rules" both render as no factors, and the
    # `source` field above is what distinguishes them.
    cadence_factors: list[CadenceFactorOut] = Field(default_factory=list)
    staff_note: Optional[str] = None

    @field_validator("cadence_factors", mode="before")
    @classmethod
    def _null_factors_are_empty(cls, value: Any) -> Any:
        return [] if value is None else value


class ScheduleCallRequest(BaseModel):
    """Counsellor sets the time for the next check-in (AI or Counsellor)."""

    scheduled_for: datetime
    channel: Literal["VOICE", "TEXT"] = "VOICE"
    note: Optional[str] = Field(default=None, max_length=500)
    follow_up_type: Optional[Literal["COUNSELLOR", "AI"]] = None
    reason: Optional[str] = Field(default=None, max_length=255)


class DueCallResponse(BaseModel):
    """Patient-facing: is a check-in due right now?

    Carries no risk band, no score and no counsellor-facing reason — the person is
    told a check-in is due, never how they are being assessed.
    """

    due: bool
    follow_up_id: Optional[int] = None
    scheduled_for: Optional[datetime] = None
    channel: Optional[str] = None
    seconds_until: Optional[int] = None
    set_by_counsellor: bool = False


class AlertOut(ORMModel):
    id: int
    case_id: int
    severity: str
    status: str
    factors: list[FactorOut] = Field(default_factory=list)
    created_at: datetime
    acknowledged_at: Optional[datetime] = None


class AlertListItem(AlertOut):
    case_ref: str
    display_name: str
    uid: str
    current_risk: Optional[str] = None
    direction: Optional[str] = None


class CaseListItem(BaseModel):
    case_id: int
    case_ref: str
    uid: str
    display_name: str
    preferred_language: str
    status: str
    legal_stage: Optional[str]
    risk_level: Optional[str]
    distress_score: Optional[float]
    threat_score: Optional[float]
    trend: Optional[str]
    direction: Optional[str]
    last_check_in: Optional[datetime]
    next_follow_up: Optional[datetime]
    open_alerts: int = 0


class CaseDetail(BaseModel):
    """Everything the case view needs on first paint — latest report included,
    so the counsellor never sees an empty shell while a second request loads."""

    case_id: int
    case_ref: str
    uid: str
    display_name: str
    preferred_language: str
    preferred_channel: str
    safe_contact_start: str
    safe_contact_end: str
    status: str
    legal_stage: Optional[str]
    opened_at: datetime

    latest_report: Optional[ReportOut] = None
    latest_prediction: Optional[PredictionOut] = None
    next_follow_up: Optional[FollowUpOut] = None
    open_alerts: list[AlertOut] = Field(default_factory=list)
    report_count: int = 0
    interaction_count: int = 0


class TelemetryPoint(BaseModel):
    report_version: int
    created_at: datetime
    distress_score: float
    threat_score: float
    composite_score: float
    baseline_score: float
    risk_level: str
    direction: Optional[str] = None


class ReviewRequest(BaseModel):
    outcome: Literal["CONTINUE_MONITORING", "INTERVENTION_REQUIRED", "ESCALATE", "CLOSED"]
    notes: Optional[str] = None
    alert_id: Optional[int] = None
    intervention_type: Optional[
        Literal[
            "PSYCH_SUPPORT", "POLICE_PROTECTION", "RELOCATION",
            "LEGAL_AID", "MEDICAL", "COMPENSATION_FOLLOWUP",
        ]
    ] = None


class ReviewResponse(BaseModel):
    review_id: int
    outcome: str
    decided_at: datetime
    intervention_id: Optional[int] = None


class RiskDistribution(BaseModel):
    LOW: int = 0
    MODERATE: int = 0
    HIGH: int = 0
    CRITICAL: int = 0
    URGENT: int = 0


class ActivityItem(BaseModel):
    case_id: int
    case_ref: str
    display_name: str
    kind: str
    detail: str
    at: datetime


class DashboardSummary(BaseModel):
    active_cases: int
    open_alerts: int
    pending_reviews: int
    follow_ups_due: int
    risk_distribution: RiskDistribution
    priority_cases: list[CaseListItem] = Field(default_factory=list)
    recent_activity: list[ActivityItem] = Field(default_factory=list)


class HealthResponse(BaseModel):
    status: str
    app: str
    env: str
    voice_available: bool
    scoring_version: str
