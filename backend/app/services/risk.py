"""Risk banding and trajectory — contract §4.

PURE. Two decisions live here and they are deliberately separate:

  * band()    — how is this person doing RIGHT NOW
  * predict() — where is the pattern heading

The dashboard must render these as distinct things. Collapsing them is how a
stable-but-endangered person gets deprioritised.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Sequence

from app.services.signals import PriorReport, SignalSet

VERSION = "1.0.0"

RiskLevel = Literal["LOW", "MODERATE", "HIGH", "CRITICAL", "URGENT"]
Direction = Literal["DE_ESCALATING", "STABLE", "ESCALATING", "INSUFFICIENT_DATA"]

RISK_ORDER: dict[str, int] = {"LOW": 0, "MODERATE": 1, "HIGH": 2, "CRITICAL": 3, "URGENT": 4}

# Threat thresholds sit BELOW distress thresholds on purpose: credible external
# danger escalates even when the person sounds composed.
THREAT_CRITICAL, DISTRESS_CRITICAL = 70.0, 80.0
THREAT_HIGH, DISTRESS_HIGH = 50.0, 60.0
THREAT_MODERATE, DISTRESS_MODERATE = 30.0, 40.0

SLOPE_WINDOW = 4  # 3 priors + current
SLOPE_ESCALATING = 4.0
HORIZON = "NEXT_2_CHECKINS"


@dataclass(frozen=True, slots=True)
class PredictionResult:
    direction: Direction
    escalation_risk: float
    slope: float
    horizon: str
    sample_size: int


def band(distress: float, threat: float, signals: SignalSet) -> RiskLevel:
    """Current-state risk band. Contract §4."""
    if signals.crisis.imminent_danger or signals.crisis.suicidal_intent:
        return "URGENT"
    if threat >= THREAT_CRITICAL or distress >= DISTRESS_CRITICAL:
        return "CRITICAL"
    if threat >= THREAT_HIGH or distress >= DISTRESS_HIGH:
        return "HIGH"
    if threat >= THREAT_MODERATE or distress >= DISTRESS_MODERATE:
        return "MODERATE"
    return "LOW"


def _least_squares_slope(values: Sequence[float]) -> float:
    """Slope of the best-fit line over index 0..n-1. Zero when n < 3.

    Closed form rather than numpy: fewer dependencies, exactly reproducible.
    """
    n = len(values)
    if n < 3:
        return 0.0
    mean_x = (n - 1) / 2.0
    mean_y = sum(values) / n
    numerator = sum((i - mean_x) * (y - mean_y) for i, y in enumerate(values))
    denominator = sum((i - mean_x) ** 2 for i in range(n))
    if denominator == 0:
        return 0.0
    return numerator / denominator


def predict(
    current_distress: float,
    current_threat: float,
    composite: float,
    priors: Sequence[PriorReport],
) -> PredictionResult:
    """Trajectory over the last 3 prior reports plus the current one. Contract §4.

    This is a prioritisation aid. It is never presented as a clinical or crisis
    prediction, and the UI is required to label it as such.
    """
    window = [p.distress_score for p in list(priors)[-(SLOPE_WINDOW - 1) :]] + [current_distress]
    n = len(window)

    if n < 3:
        # Not enough points for a meaningful line; report honestly rather than
        # inventing a direction from two readings.
        return PredictionResult(
            direction="INSUFFICIENT_DATA",
            escalation_risk=round(max(0.0, min(100.0, 0.5 * composite + 0.2 * current_threat)), 1),
            slope=0.0,
            horizon=HORIZON,
            sample_size=n,
        )

    slope = _least_squares_slope(window)

    if slope >= SLOPE_ESCALATING:
        direction: Direction = "ESCALATING"
    elif slope <= -SLOPE_ESCALATING:
        direction = "DE_ESCALATING"
    else:
        direction = "STABLE"

    escalation_risk = round(
        max(
            0.0,
            min(
                100.0,
                0.5 * composite + 0.3 * max(0.0, min(100.0, slope * 5.0)) + 0.2 * current_threat,
            ),
        ),
        1,
    )

    return PredictionResult(
        direction=direction,
        escalation_risk=escalation_risk,
        slope=round(slope, 3),
        horizon=HORIZON,
        sample_size=n,
    )


def is_at_least(level: RiskLevel, minimum: RiskLevel) -> bool:
    return RISK_ORDER[level] >= RISK_ORDER[minimum]
