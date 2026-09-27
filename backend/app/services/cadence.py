"""Predicted follow-up cadence — when the next check-in should happen.

PURE. No I/O, no network, no LLM, no clock, no randomness.

Contract §6 fixes a follow-up interval per risk band (LOW 14d … URGENT 1d). That
table is now the GUARDRAIL, not the answer: the interval is predicted from this
particular conversation's own evidence, and then clamped so a prediction can
never make a dangerous case wait longer than the contract allows.

    predicted = clamp(base_for_band × Π adjustments, band_min, band_max)

Why this is arithmetic and not a model call. The interval is a number, so contract
rule 1 applies with full force: the LLM never computes it. An LLM asked "when
should we call back?" would give a plausible answer that nobody could defend or
reproduce — and this number decides how long someone in danger waits. Everything
here is a fixed multiplier table over signals the extraction step already
produced, so the same conversation always yields the same interval, and every
adjustment names the reason it fired.

The reasons are the point. `CadenceResult.factors` carries one entry per fired
rule, in a fixed order, so the dashboard can show a caseworker *why* the next
call is on Thursday rather than next week — and the caseworker can override it.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Sequence

from app.services.baseline import BaselineResult, engagement_declined
from app.services.signals import PROTECTIVE_KEYS, PriorReport, SignalSet

VERSION = "1.0.0"

HOUR = 1.0
DAY = 24.0

# Contract §6 intervals, in hours. These are where a band starts before this
# conversation's evidence moves it.
BASE_HOURS: dict[str, float] = {
    "URGENT": 1 * DAY,
    "CRITICAL": 1 * DAY,
    "HIGH": 3 * DAY,
    "MODERATE": 7 * DAY,
    "LOW": 14 * DAY,
}

# Hard bounds per band. The upper bound is the safety guarantee: no combination
# of protective signals can stretch a CRITICAL case past two days. The lower
# bound stops a pile-up of tightening rules from scheduling a call in an hour,
# which reads as harassment rather than care.
BOUNDS_HOURS: dict[str, tuple[float, float]] = {
    "URGENT": (12 * HOUR, 1 * DAY),
    "CRITICAL": (12 * HOUR, 2 * DAY),
    "HIGH": (1 * DAY, 4 * DAY),
    "MODERATE": (2 * DAY, 10 * DAY),
    "LOW": (4 * DAY, 14 * DAY),
}

# Granularity. Predicting "4.37 days" implies precision this does not have, and a
# caseworker reads 6-hour steps as a real schedule.
ROUND_TO_HOURS = 6.0

DEVIATION_TIGHTEN = 10.0
DEVIATION_LOOSEN = -10.0
CHANGE_TIGHTEN = 8.0
CHANGE_LOOSEN = -8.0
SIGNAL_THRESHOLD = 0.5
LOW_COOPERATIVENESS = 0.4


@dataclass(frozen=True, slots=True)
class CadenceFactor:
    """One rule that moved the interval. `multiplier` < 1 tightens."""

    code: str
    label: str
    multiplier: float


@dataclass(frozen=True, slots=True)
class CadenceResult:
    hours: float
    base_hours: float
    band: str
    factors: tuple[CadenceFactor, ...]
    clamped: bool
    version: str = VERSION

    @property
    def days(self) -> float:
        return round(self.hours / DAY, 2)

    def describe(self) -> str:
        """Human-readable interval. Used in the follow-up reason string."""
        if self.hours < DAY:
            return f"{int(round(self.hours))}h"
        whole_days = int(self.hours // DAY)
        remainder = int(round(self.hours - whole_days * DAY))
        if remainder == 0:
            return f"{whole_days}d"
        return f"{whole_days}d {remainder}h"


# --------------------------------------------------------------------------
# The rule table. Order is fixed so `factors` is deterministic.
# --------------------------------------------------------------------------
#
# Tightening rules (multiplier < 1) answer: what did this conversation show that
# means we should not wait as long? Loosening rules (> 1) answer: what showed
# that the pressure is genuinely easing? Loosening can never breach the band's
# upper bound, so "they sounded better" can slow a check-in but never postpone a
# dangerous one.

def _rules(
    signals: SignalSet,
    *,
    baseline: BaselineResult,
    change: float,
    direction: str,
    priors: Sequence[PriorReport],
) -> list[CadenceFactor]:
    fired: list[CadenceFactor] = []

    def add(code: str, label: str, multiplier: float) -> None:
        fired.append(CadenceFactor(code=code, label=label, multiplier=multiplier))

    # --- trajectory -------------------------------------------------------
    if direction == "ESCALATING":
        add("CADENCE_ESCALATING", "Escalating trajectory — check in sooner", 0.5)
    elif direction == "DE_ESCALATING":
        add("CADENCE_DE_ESCALATING", "Improving trajectory — more room between calls", 1.25)

    # --- movement against this person's own history -----------------------
    if baseline.confidence != "NONE":
        if baseline.deviation >= DEVIATION_TIGHTEN:
            add("CADENCE_ABOVE_BASELINE", "Above personal baseline", 0.7)
        elif baseline.deviation <= DEVIATION_LOOSEN:
            add("CADENCE_BELOW_BASELINE", "Below personal baseline", 1.15)

    if change >= CHANGE_TIGHTEN:
        add("CADENCE_DISTRESS_ROSE", "Distress rose since last check-in", 0.8)
    elif change <= CHANGE_LOOSEN:
        add("CADENCE_DISTRESS_FELL", "Distress fell since last check-in", 1.1)

    # --- what was disclosed in THIS conversation --------------------------
    # Something new happening outweighs everything else about tempo.
    if (
        signals.t("new_incident_reported") > 0.0
        or signals.t("direct_threat_received") >= SIGNAL_THRESHOLD
    ):
        add("CADENCE_NEW_THREAT", "New incident or direct threat disclosed", 0.6)

    if signals.t("unsafe_at_home") >= SIGNAL_THRESHOLD:
        add("CADENCE_UNSAFE_AT_HOME", "Does not feel safe at home", 0.7)

    if signals.t("perpetrator_proximity") >= SIGNAL_THRESHOLD:
        add("CADENCE_PERPETRATOR_NEARBY", "Perpetrator in proximity", 0.75)

    if signals.d("self_harm_ideation") >= SIGNAL_THRESHOLD:
        add("CADENCE_SELF_HARM", "Self-harm ideation present", 0.5)

    if signals.d("hopelessness") >= SIGNAL_THRESHOLD:
        add("CADENCE_HOPELESSNESS", "Expressions of hopelessness", 0.85)

    # --- how the conversation itself went ---------------------------------
    # Withdrawal is deterioration. Someone giving less than they used to is a
    # reason to call sooner, not later — the quiet check-in is the warning.
    if engagement_declined(signals.engagement.avg_user_chars, priors):
        add("CADENCE_ENGAGEMENT_DECLINED", "Engagement declined", 0.7)

    if (
        signals.engagement.disclosure_depth == "LOW"
        and signals.engagement.cooperativeness < LOW_COOPERATIVENESS
    ):
        add("CADENCE_WITHDRAWN_IN_CALL", "Shared little in this check-in", 0.85)

    # --- how well we know them -------------------------------------------
    # With no established baseline the assessment is weak, so the answer is to
    # look again sooner rather than to trust it.
    if baseline.confidence in ("NONE", "LOW"):
        add("CADENCE_BASELINE_UNRELIABLE", "Baseline not yet established", 0.85)

    # --- protective context ----------------------------------------------
    present = [signals.p(k) for k in PROTECTIVE_KEYS if signals.p(k) > 0.0]
    if present and (sum(present) / len(present)) >= SIGNAL_THRESHOLD:
        add("CADENCE_PROTECTIVE_SUPPORT", "Support factors present", 1.15)

    if signals.p("legal_progress") >= SIGNAL_THRESHOLD:
        add("CADENCE_LEGAL_PROGRESS", "Legal process progressing", 1.1)

    return fired


def _round_to_step(hours: float, step: float = ROUND_TO_HOURS) -> float:
    return round(round(hours / step) * step, 2)


def predict_interval(
    signals: SignalSet,
    *,
    band: str,
    baseline: BaselineResult,
    change: float,
    direction: str,
    priors: Sequence[PriorReport],
) -> CadenceResult:
    """Predict the interval to the next check-in, in hours.

    Deterministic: same conversation, same history, same interval — always.
    """
    base = BASE_HOURS[band]
    low, high = BOUNDS_HOURS[band]

    factors = _rules(
        signals, baseline=baseline, change=change, direction=direction, priors=priors
    )

    raw = base
    for factor in factors:
        raw *= factor.multiplier

    stepped = _round_to_step(raw)
    # Every bound in BOUNDS_HOURS is a multiple of ROUND_TO_HOURS, so clamping
    # cannot land off the grid and no re-stepping is needed. `test_bounds_are_on_
    # the_rounding_grid` pins that assumption, because if a future bound breaks it
    # the clamped flag below would start lying.
    final = max(low, min(high, stepped))

    return CadenceResult(
        hours=final,
        base_hours=base,
        band=band,
        factors=tuple(factors),
        clamped=abs(final - stepped) > 1e-9,
    )


def factors_to_json(result: CadenceResult) -> list[dict[str, Any]]:
    """Serialise for persistence and for the dashboard's "why this date" panel."""
    return [
        {"code": f.code, "label": f.label, "multiplier": round(f.multiplier, 3)}
        for f in result.factors
    ]


def reason_for(band: str, result: CadenceResult, direction: str) -> str:
    """The FollowUp.reason string. Derived, never hand-written per case."""
    base = {
        "LOW": "Routine monitoring",
        "MODERATE": "Elevated indicators — closer monitoring",
        "HIGH": "High risk — early follow-up",
        "CRITICAL": "Critical risk — next-day follow-up",
        "URGENT": "Urgent concern disclosed — immediate follow-up",
    }[band]

    detail = f"predicted {result.describe()}"
    if result.clamped:
        # Worth surfacing: the guardrail, not the evidence, set this date.
        detail += ", capped by band"
    if direction == "ESCALATING":
        detail += ", escalating trajectory"

    return f"{base} ({detail})"


__all__ = [
    "VERSION",
    "BASE_HOURS",
    "BOUNDS_HOURS",
    "CadenceFactor",
    "CadenceResult",
    "predict_interval",
    "factors_to_json",
    "reason_for",
]
