"""Signal taxonomy types — contract §1.

Plain frozen dataclasses, deliberately decoupled from the ORM. The pure services
consume these and nothing else, which is what keeps them testable without a
database, a network or an LLM.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal, Mapping

SCHEMA_VERSION = "1.0.0"

DisclosureDepth = Literal["LOW", "MEDIUM", "HIGH"]

DISTRESS_KEYS: tuple[str, ...] = (
    "hopelessness",
    "sadness_low_mood",
    "anxiety_fear",
    "sleep_disturbance",
    "appetite_change",
    "social_withdrawal",
    "somatic_complaints",
    "shame_stigma",
    "anger_irritability",
    "self_harm_ideation",
)

THREAT_KEYS: tuple[str, ...] = (
    "direct_threat_received",
    "new_incident_reported",
    "intimidation_pressure",
    "perpetrator_proximity",
    "unsafe_at_home",
    "social_boycott",
    "institutional_inaction",
    "economic_coercion",
)

PROTECTIVE_KEYS: tuple[str, ...] = (
    "family_support",
    "community_support",
    "legal_progress",
    "engagement_with_services",
)


@dataclass(frozen=True, slots=True)
class Signal:
    present: bool = False
    intensity: float = 0.0
    evidence: str = ""

    def __post_init__(self) -> None:
        if not 0.0 <= self.intensity <= 1.0:
            raise ValueError(f"intensity out of range: {self.intensity}")
        # Contract invariant: absent signals carry no intensity.
        if not self.present and self.intensity != 0.0:
            raise ValueError("intensity must be 0.0 when present is False")

    @property
    def effective(self) -> float:
        """Intensity that counts toward scoring — zero unless present."""
        return self.intensity if self.present else 0.0


@dataclass(frozen=True, slots=True)
class Engagement:
    turn_count: int = 0
    avg_user_chars: float = 0.0
    disclosure_depth: DisclosureDepth = "LOW"
    cooperativeness: float = 0.0


@dataclass(frozen=True, slots=True)
class Crisis:
    imminent_danger: bool = False
    suicidal_intent: bool = False
    trigger_quote: str = ""

    @property
    def any(self) -> bool:
        return self.imminent_danger or self.suicidal_intent


@dataclass(frozen=True, slots=True)
class SignalSet:
    """One interaction's extracted signals."""

    distress: Mapping[str, Signal] = field(default_factory=dict)
    threat: Mapping[str, Signal] = field(default_factory=dict)
    protective: Mapping[str, Signal] = field(default_factory=dict)
    engagement: Engagement = field(default_factory=Engagement)
    crisis: Crisis = field(default_factory=Crisis)
    summary: str = ""
    language_detected: str = "hi"
    schema_version: str = SCHEMA_VERSION

    def d(self, key: str) -> float:
        """Effective distress intensity; 0.0 when the key is absent."""
        s = self.distress.get(key)
        return s.effective if s else 0.0

    def t(self, key: str) -> float:
        s = self.threat.get(key)
        return s.effective if s else 0.0

    def p(self, key: str) -> float:
        s = self.protective.get(key)
        return s.effective if s else 0.0

    def evidence_for(self, group: str, key: str) -> str:
        table = {"distress": self.distress, "threat": self.threat, "protective": self.protective}
        s = table.get(group, {}).get(key)
        return s.evidence if s else ""


def _signals_from(raw: Any, keys: tuple[str, ...]) -> dict[str, Signal]:
    raw = raw or {}
    out: dict[str, Signal] = {}
    for k in keys:
        item = raw.get(k) or {}
        present = bool(item.get("present", False))
        intensity = float(item.get("intensity", 0.0) or 0.0)
        # Defensive repair rather than rejection: an LLM that emits
        # present=false with a stray intensity should not break scoring.
        if not present:
            intensity = 0.0
        intensity = min(1.0, max(0.0, intensity))
        out[k] = Signal(present=present, intensity=intensity, evidence=str(item.get("evidence", "")))
    return out


def signal_set_from_dict(raw: Mapping[str, Any]) -> SignalSet:
    """Build a SignalSet from the §1 JSON. Total: missing keys become defaults."""
    eng_raw = raw.get("engagement") or {}
    depth = str(eng_raw.get("disclosure_depth", "LOW")).upper()
    if depth not in ("LOW", "MEDIUM", "HIGH"):
        depth = "LOW"

    crisis_raw = raw.get("crisis") or {}

    return SignalSet(
        distress=_signals_from(raw.get("distress_signals"), DISTRESS_KEYS),
        threat=_signals_from(raw.get("threat_signals"), THREAT_KEYS),
        protective=_signals_from(raw.get("protective_signals"), PROTECTIVE_KEYS),
        engagement=Engagement(
            turn_count=int(eng_raw.get("turn_count", 0) or 0),
            avg_user_chars=float(eng_raw.get("avg_user_chars", 0.0) or 0.0),
            disclosure_depth=depth,  # type: ignore[arg-type]
            cooperativeness=min(1.0, max(0.0, float(eng_raw.get("cooperativeness", 0.0) or 0.0))),
        ),
        crisis=Crisis(
            imminent_danger=bool(crisis_raw.get("imminent_danger", False)),
            suicidal_intent=bool(crisis_raw.get("suicidal_intent", False)),
            trigger_quote=str(crisis_raw.get("trigger_quote", "")),
        ),
        summary=str(raw.get("summary", "")),
        language_detected=str(raw.get("language_detected", "hi")),
        schema_version=str(raw.get("schema_version", SCHEMA_VERSION)),
    )


@dataclass(frozen=True, slots=True)
class PriorReport:
    """Minimal historical projection the pure services need."""

    report_version: int
    distress_score: float
    threat_score: float
    avg_user_chars: float = 0.0
