"""Personal baseline and trend — contract §3.

PURE. Baseline is always computed from the case's OWN prior reports. User A's
history must never influence User B's baseline; that isolation is enforced by
the caller passing only this case's history, and by these functions holding no
state of their own.

Cold start is explicit, never hidden: `confidence` tells the UI how much to
trust the baseline, and the dashboard is required to surface it.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Sequence

from app.services.signals import PriorReport

VERSION = "1.0.0"

BaselineConfidence = Literal["NONE", "LOW", "MEDIUM", "HIGH"]
Trend = Literal["IMPROVING", "STABLE", "WORSENING", "INSUFFICIENT_DATA"]

BASELINE_WINDOW = 5
TREND_DELTA = 8.0


@dataclass(frozen=True, slots=True)
class BaselineResult:
    baseline: float
    confidence: BaselineConfidence
    deviation: float
    sample_size: int


def compute_baseline(current_distress: float, priors: Sequence[PriorReport]) -> BaselineResult:
    """Baseline over up to the 5 most recent PRIOR reports (current excluded).

    `priors` must be chronological (oldest first) and must not include the
    report being assessed.
    """
    window = list(priors)[-BASELINE_WINDOW:]
    n = len(window)

    if n == 0:
        # No history: the person is their own baseline, and we say so.
        return BaselineResult(
            baseline=round(current_distress, 1), confidence="NONE", deviation=0.0, sample_size=0
        )

    scores = [p.distress_score for p in window]
    baseline = round(sum(scores) / n, 1)

    if n == 1:
        confidence: BaselineConfidence = "LOW"
    elif n <= 4:
        confidence = "MEDIUM"
    else:
        confidence = "HIGH"

    return BaselineResult(
        baseline=baseline,
        confidence=confidence,
        deviation=round(current_distress - baseline, 1),
        sample_size=n,
    )


def previous_score(priors: Sequence[PriorReport]) -> float | None:
    """Distress score of the immediately preceding report, if any."""
    return priors[-1].distress_score if priors else None


def compute_trend(current_distress: float, priors: Sequence[PriorReport]) -> tuple[Trend, float]:
    """(trend, change) against the immediately previous report. Contract §3."""
    prev = previous_score(priors)
    if prev is None:
        return "INSUFFICIENT_DATA", 0.0

    change = round(current_distress - prev, 1)
    if change >= TREND_DELTA:
        return "WORSENING", change
    if change <= -TREND_DELTA:
        return "IMPROVING", change
    return "STABLE", change


def engagement_declined(current_avg_chars: float, priors: Sequence[PriorReport]) -> bool:
    """True when this interaction is markedly shorter than the case's norm.

    Requires at least 2 priors — with less history the "norm" is noise.
    Non-response and withdrawal are themselves deterioration signals.
    """
    history = [p.avg_user_chars for p in priors if p.avg_user_chars > 0]
    if len(history) < 2:
        return False
    mean_chars = sum(history) / len(history)
    if mean_chars <= 0:
        return False
    return current_avg_chars < (0.6 * mean_chars)
