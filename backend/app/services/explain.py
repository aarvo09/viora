"""Explanation factors — contract §5.

PURE, and the ONLY place a factor may originate. Every "why" the counsellor
sees is a rule that fired against real extracted signals and real score deltas.

An LLM may rephrase a factor's label for display. It may never add one. That is
what makes the explainability claim true rather than merely plausible.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any, Literal, Sequence

from app.services.baseline import BaselineResult, engagement_declined
from app.services.risk import Direction
from app.services.signals import PriorReport, SignalSet

VERSION = "1.0.0"

Severity = Literal["INFO", "CONCERN", "SERIOUS"]
SEVERITY_ORDER: dict[str, int] = {"SERIOUS": 0, "CONCERN": 1, "INFO": 2}

THRESH = 0.5
DEVIATION_CONCERN = 10.0
CHANGE_DELTA = 8.0
THREAT_ELEVATED = 50.0


@dataclass(frozen=True, slots=True)
class Factor:
    code: str
    label: str
    severity: Severity
    evidence: str = ""
    value: float | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def build_factors(
    signals: SignalSet,
    *,
    distress: float,
    threat: float,
    baseline: BaselineResult,
    change: float,
    has_previous: bool,
    direction: Direction,
    priors: Sequence[PriorReport],
) -> list[Factor]:
    """Evaluate the §5 rule table. Returns SERIOUS → CONCERN → INFO."""
    out: list[Factor] = []

    def add(code: str, label: str, sev: Severity, evidence: str = "", value: float | None = None) -> None:
        out.append(Factor(code=code, label=label, severity=sev, evidence=evidence, value=value))

    # ---------------- SERIOUS ----------------
    if signals.crisis.imminent_danger:
        add("CRISIS_IMMINENT_DANGER", "Immediate danger disclosed", "SERIOUS", signals.crisis.trigger_quote)
    if signals.crisis.suicidal_intent:
        add("CRISIS_SUICIDAL_INTENT", "Suicidal intent disclosed", "SERIOUS", signals.crisis.trigger_quote)

    if signals.d("self_harm_ideation") >= THRESH:
        add(
            "SELF_HARM_IDEATION",
            "Self-harm ideation present",
            "SERIOUS",
            signals.evidence_for("distress", "self_harm_ideation"),
            signals.d("self_harm_ideation"),
        )
    if signals.t("new_incident_reported") > 0.0:
        add(
            "NEW_INCIDENT",
            "New incident reported",
            "SERIOUS",
            signals.evidence_for("threat", "new_incident_reported"),
            signals.t("new_incident_reported"),
        )
    if signals.t("direct_threat_received") >= THRESH:
        add(
            "DIRECT_THREAT",
            "Direct threat received",
            "SERIOUS",
            signals.evidence_for("threat", "direct_threat_received"),
            signals.t("direct_threat_received"),
        )
    if signals.t("unsafe_at_home") >= THRESH:
        add(
            "UNSAFE_AT_HOME",
            "Reports not feeling safe at home",
            "SERIOUS",
            signals.evidence_for("threat", "unsafe_at_home"),
            signals.t("unsafe_at_home"),
        )
    if signals.t("intimidation_pressure") >= THRESH:
        add(
            "WITHDRAWAL_PRESSURE",
            "Pressure to withdraw complaint",
            "SERIOUS",
            signals.evidence_for("threat", "intimidation_pressure"),
            signals.t("intimidation_pressure"),
        )

    # ---------------- CONCERN ----------------
    # Baseline comparison is suppressed at NONE confidence: with no history a
    # "deviation" is meaningless and would be actively misleading.
    if baseline.confidence != "NONE" and baseline.deviation >= DEVIATION_CONCERN:
        add(
            "DISTRESS_ABOVE_BASELINE",
            "Distress above personal baseline",
            "CONCERN",
            f"{baseline.deviation:+.1f} vs baseline {baseline.baseline:.1f}",
            baseline.deviation,
        )
    if has_previous and change >= CHANGE_DELTA:
        add("DISTRESS_ROSE", "Distress increased since last check-in", "CONCERN", f"{change:+.1f}", change)
    if threat >= THREAT_ELEVATED:
        add("THREAT_ELEVATED", "Elevated external threat", "CONCERN", f"threat {threat:.1f}", threat)
    if signals.t("perpetrator_proximity") >= THRESH:
        add(
            "PERPETRATOR_NEARBY",
            "Perpetrator in proximity",
            "CONCERN",
            signals.evidence_for("threat", "perpetrator_proximity"),
            signals.t("perpetrator_proximity"),
        )
    if signals.d("sleep_disturbance") >= THRESH:
        add(
            "SLEEP_CONCERN",
            "Sleep disturbance",
            "CONCERN",
            signals.evidence_for("distress", "sleep_disturbance"),
            signals.d("sleep_disturbance"),
        )
    if signals.d("hopelessness") >= THRESH:
        add(
            "HOPELESSNESS",
            "Expressions of hopelessness",
            "CONCERN",
            signals.evidence_for("distress", "hopelessness"),
            signals.d("hopelessness"),
        )
    if signals.d("social_withdrawal") >= THRESH or signals.t("social_boycott") >= THRESH:
        evidence = signals.evidence_for("distress", "social_withdrawal") or signals.evidence_for(
            "threat", "social_boycott"
        )
        add(
            "SOCIAL_ISOLATION",
            "Social isolation",
            "CONCERN",
            evidence,
            max(signals.d("social_withdrawal"), signals.t("social_boycott")),
        )
    if signals.t("institutional_inaction") >= THRESH:
        add(
            "INSTITUTIONAL_INACTION",
            "Reports institutional inaction",
            "CONCERN",
            signals.evidence_for("threat", "institutional_inaction"),
            signals.t("institutional_inaction"),
        )
    if engagement_declined(signals.engagement.avg_user_chars, priors):
        add(
            "ENGAGEMENT_DECLINED",
            "Engagement declined",
            "CONCERN",
            f"avg {signals.engagement.avg_user_chars:.0f} chars this check-in",
            signals.engagement.avg_user_chars,
        )
    if direction == "ESCALATING":
        add("TREND_ESCALATING", "Pattern suggests escalation", "CONCERN")

    # ---------------- INFO ----------------
    if has_previous and change <= -CHANGE_DELTA:
        add("DISTRESS_FELL", "Distress decreased since last check-in", "INFO", f"{change:+.1f}", change)

    protective_hits = [k for k in ("family_support", "community_support", "engagement_with_services") if signals.p(k) >= THRESH]
    if protective_hits:
        add(
            "PROTECTIVE_SUPPORT",
            "Support factors present",
            "INFO",
            signals.evidence_for("protective", protective_hits[0]),
            max(signals.p(k) for k in protective_hits),
        )
    if signals.p("legal_progress") >= THRESH:
        add(
            "LEGAL_PROGRESS",
            "Legal process progressing",
            "INFO",
            signals.evidence_for("protective", "legal_progress"),
            signals.p("legal_progress"),
        )
    if baseline.confidence in ("NONE", "LOW"):
        add(
            "BASELINE_UNRELIABLE",
            "Baseline not yet established",
            "INFO",
            f"{baseline.sample_size} prior check-in(s)",
            float(baseline.sample_size),
        )

    # Stable ordering: severity first, insertion order preserved within a tier.
    return sorted(out, key=lambda f: SEVERITY_ORDER[f.severity])


def factors_to_json(factors: Sequence[Factor]) -> list[dict[str, Any]]:
    return [f.to_dict() for f in factors]
