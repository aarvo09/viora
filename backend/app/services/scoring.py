"""Deterministic scoring — contract §2.

PURE. No I/O, no network, no LLM, no clock, no randomness.
Same input always yields byte-identical output; that is a product requirement,
not an implementation detail.

The LLM never computes a number. It emits per-signal intensities; everything
here is arithmetic over those intensities.
"""

from __future__ import annotations

from app.services.signals import PROTECTIVE_KEYS, SignalSet

VERSION = "1.0.0"

WEIGHTS_DISTRESS: dict[str, float] = {
    "hopelessness": 1.0,
    "self_harm_ideation": 1.0,
    "anxiety_fear": 0.8,
    "sadness_low_mood": 0.7,
    "sleep_disturbance": 0.6,
    "social_withdrawal": 0.6,
    "shame_stigma": 0.5,
    "anger_irritability": 0.5,
    "appetite_change": 0.4,
    "somatic_complaints": 0.4,
}
W_SUM_DISTRESS = 6.5

WEIGHTS_THREAT: dict[str, float] = {
    "direct_threat_received": 1.0,
    "new_incident_reported": 1.0,
    "intimidation_pressure": 0.9,
    "unsafe_at_home": 0.9,
    "perpetrator_proximity": 0.8,
    "social_boycott": 0.6,
    "institutional_inaction": 0.5,
    "economic_coercion": 0.5,
}
W_SUM_THREAT = 6.2

PROTECTIVE_DAMPENER_MAX = 0.15
SELF_HARM_FLOOR_THRESHOLD = 0.5
SELF_HARM_FLOOR_SCORE = 75.0
IMMINENT_DANGER_FLOOR_SCORE = 85.0


def _clamp(value: float, low: float = 0.0, high: float = 100.0) -> float:
    return max(low, min(high, value))


def protective_dampener(signals: SignalSet) -> float:
    """Multiplier in [0.85, 1.0] from present protective factors.

    Mean is over PRESENT protective signals only. With none present the
    multiplier is exactly 1.0 — absence of support is not itself a penalty.
    """
    intensities = [signals.p(k) for k in PROTECTIVE_KEYS if signals.p(k) > 0.0]
    if not intensities:
        return 1.0
    mean_intensity = sum(intensities) / len(intensities)
    return 1.0 - (PROTECTIVE_DAMPENER_MAX * mean_intensity)


def distress_score(signals: SignalSet) -> float:
    """Internal state, 0–100, one decimal. Contract §2.1."""
    raw = sum(weight * signals.d(key) for key, weight in WEIGHTS_DISTRESS.items())
    base = 100.0 * raw / W_SUM_DISTRESS
    score = round(_clamp(base * protective_dampener(signals)), 1)

    # Hard floor: explicit self-harm ideation can never read as mild, however
    # much protective context surrounds it.
    if signals.d("self_harm_ideation") >= SELF_HARM_FLOOR_THRESHOLD:
        score = max(score, SELF_HARM_FLOOR_SCORE)

    return score


def threat_score(signals: SignalSet) -> float:
    """External danger, 0–100, one decimal. Contract §2.2.

    Deliberately NOT dampened by protective factors: emotional support does not
    reduce physical danger. Do not "improve" this.
    """
    raw = sum(weight * signals.t(key) for key, weight in WEIGHTS_THREAT.items())
    score = round(_clamp(100.0 * raw / W_SUM_THREAT), 1)

    if signals.crisis.imminent_danger:
        score = max(score, IMMINENT_DANGER_FLOOR_SCORE)

    return score


def composite_score(distress: float, threat: float) -> float:
    """Weighted blend for display and prediction only. Contract §2.3.

    Never stored as the risk band — banding reads both axes independently, so a
    calm person under severe threat still escalates.
    """
    hi, lo = max(distress, threat), min(distress, threat)
    return round(hi * 0.7 + lo * 0.3, 1)


def score_all(signals: SignalSet) -> tuple[float, float, float]:
    """Convenience: (distress, threat, composite)."""
    d = distress_score(signals)
    t = threat_score(signals)
    return d, t, composite_score(d, t)
