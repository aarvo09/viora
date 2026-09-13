"""LangGraph assessment workflow — contract §6.

    ingest → extract → score → baseline → risk → predict → explain → decide → persist

This module owns the ORCHESTRATION only. Read this before changing anything:

    The graph moves state between nodes. It never computes a number.

Every node here is a thin wrapper that calls the corresponding pure service in
`app.services.{scoring,baseline,risk,explain}` and writes the result into the
graph state. No arithmetic lives in this file, and none may ever be added to it.
That is what keeps `scoring.py` et al. testable with no graph, no database and no
network — and what makes "the same interaction always scores identically" a
property of the system rather than a hope.

Why a graph at all, when the happy path is linear? Because the path is not
actually linear: `decide` branches on the risk band, a crisis short-circuits
mid-conversation, and the audit trail in `WorkflowEvent` is meant to be a record
of node transitions. Contract §6 names LangGraph, so LangGraph is what runs it.

Determinism note: the graph adds no randomness and no clock of its own. `now` is
injected into the state by the caller exactly as it was before, and node order is
fixed by the edges below, so a given (signals, priors, now) triple produces a
byte-identical result on every run.

Failure posture: if LangGraph is not installed, `build_graph()` raises at import
of the graph only — `run_assessment()` in `assessment.py` falls back to the
sequential executor in this module, which walks the same node functions in the
same order. A missing dependency must never mean a person's check-in produces no
report.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Any, Callable, Optional, TypedDict

from app.config import settings
from app.services import baseline as baseline_svc
from app.services import cadence as cadence_svc
from app.services import explain as explain_svc
from app.services import risk as risk_svc
from app.services import scoring as scoring_svc
from app.services.signals import PriorReport, SignalSet, signal_set_from_dict

logger = logging.getLogger(__name__)

GRAPH_VERSION = "1.0.0"

# Bands that require a human to look at the case. Contract §6.
ALERTING_BANDS = ("HIGH", "CRITICAL", "URGENT")

FOLLOWUP_DAYS: dict[str, int] = {
    "LOW": settings.FOLLOWUP_DAYS_LOW,
    "MODERATE": settings.FOLLOWUP_DAYS_MODERATE,
    "HIGH": settings.FOLLOWUP_DAYS_HIGH,
    "CRITICAL": settings.FOLLOWUP_DAYS_CRITICAL,
    "URGENT": settings.FOLLOWUP_DAYS_URGENT,
}

NODE_SEQUENCE: tuple[str, ...] = (
    "ingest",
    "extract",
    "score",
    "baseline",
    "risk",
    "predict",
    "explain",
    "decide",
)


# --------------------------------------------------------------------------
# Graph state
# --------------------------------------------------------------------------

class AssessmentState(TypedDict, total=False):
    """State threaded through the graph.

    Inputs (set by the caller before invoke):
        raw_signals   §1 signal JSON from the extraction LLM
        priors        this case's prior reports, oldest first, case-scoped
        now           injected clock; the graph never reads the wall clock
        channel       VOICE | TEXT, for the ingest event and the follow-up row

    Everything else is filled in by the nodes, in order.
    """

    # --- inputs ---
    raw_signals: dict[str, Any]
    priors: list[PriorReport]
    now: datetime
    channel: str

    # --- extract ---
    signals: SignalSet
    schema_version: str

    # --- score ---
    distress: float
    threat: float
    composite: float

    # --- baseline ---
    baseline: float
    baseline_confidence: str
    baseline_deviation: float
    trend: str
    change: float
    previous_score: Optional[float]

    # --- risk / predict ---
    band: str
    direction: str
    escalation_risk: float
    slope: float
    horizon: str

    # --- explain ---
    factors: list[dict[str, Any]]
    factor_codes: list[str]

    # --- decide ---
    needs_alert: bool
    follow_up_days: float
    follow_up_at: datetime
    follow_up_reason: str
    cadence_hours: float
    cadence_base_hours: float
    cadence_clamped: bool
    cadence_factors: list[dict[str, Any]]
    report_version: int

    # --- audit ---
    events: list[dict[str, Any]]


def _record(state: AssessmentState, node: str, payload: dict[str, Any],
            to_state: str | None = None) -> None:
    """Append a WorkflowEvent description to the state.

    The graph does not touch the database. `assessment.py` drains this list and
    writes the rows, so the pipeline stays testable without a session.
    """
    state.setdefault("events", []).append(
        {"node": node, "payload": payload, "to_state": to_state}
    )


# --------------------------------------------------------------------------
# Nodes. Each one: call a pure service, store the result, record the event.
# --------------------------------------------------------------------------

def node_ingest(state: AssessmentState) -> AssessmentState:
    _record(state, "ingest", {"channel": state.get("channel", "TEXT"),
                              "graph_version": GRAPH_VERSION})
    return state


def node_extract(state: AssessmentState) -> AssessmentState:
    """Materialise the §1 signal JSON into typed signals.

    Extraction itself already happened in the LLM lane (`conversation.extract`);
    this node only records it, which is why the LLM sits *outside* the
    determinism boundary and the graph inside it.
    """
    signals = signal_set_from_dict(state["raw_signals"])
    state["signals"] = signals
    state["schema_version"] = signals.schema_version
    _record(state, "extract", {"schema_version": signals.schema_version})
    return state


def node_score(state: AssessmentState) -> AssessmentState:
    distress, threat, composite = scoring_svc.score_all(state["signals"])
    state["distress"] = distress
    state["threat"] = threat
    state["composite"] = composite
    _record(state, "score", {
        "distress": distress, "threat": threat, "composite": composite,
        "scoring_version": scoring_svc.VERSION,
    })
    return state


def node_baseline(state: AssessmentState) -> AssessmentState:
    priors = state["priors"]
    distress = state["distress"]

    base = baseline_svc.compute_baseline(distress, priors)
    trend, change = baseline_svc.compute_trend(distress, priors)
    previous = baseline_svc.previous_score(priors)

    state["baseline"] = base.baseline
    state["baseline_confidence"] = base.confidence
    state["baseline_deviation"] = base.deviation
    state["trend"] = trend
    state["change"] = change
    state["previous_score"] = previous
    # Carried for the persist step; the graph must not compute it either.
    state["report_version"] = max((p.report_version for p in priors), default=0) + 1

    _record(state, "baseline", {
        "baseline": base.baseline, "confidence": base.confidence,
        "deviation": base.deviation, "trend": trend, "change": change,
    })
    return state


def node_risk(state: AssessmentState) -> AssessmentState:
    band = risk_svc.band(state["distress"], state["threat"], state["signals"])
    state["band"] = band
    _record(state, "risk", {"band": band}, to_state=band)
    return state


def node_predict(state: AssessmentState) -> AssessmentState:
    prediction = risk_svc.predict(
        state["distress"], state["threat"], state["composite"], state["priors"]
    )
    state["direction"] = prediction.direction
    state["escalation_risk"] = prediction.escalation_risk
    state["slope"] = prediction.slope
    state["horizon"] = prediction.horizon
    _record(state, "predict", {
        "direction": prediction.direction,
        "escalation_risk": prediction.escalation_risk,
        "slope": prediction.slope,
    })
    return state


def node_explain(state: AssessmentState) -> AssessmentState:
    """Factors come from the §5 rule table only. Nothing is authored here."""
    base = baseline_svc.BaselineResult(
        baseline=state["baseline"],
        confidence=state["baseline_confidence"],  # type: ignore[arg-type]
        deviation=state["baseline_deviation"],
        sample_size=len(state["priors"]),
    )
    factors = explain_svc.build_factors(
        state["signals"],
        distress=state["distress"],
        threat=state["threat"],
        baseline=base,
        change=state["change"],
        has_previous=state["previous_score"] is not None,
        direction=state["direction"],
        priors=state["priors"],
    )
    state["factors"] = explain_svc.factors_to_json(factors)
    state["factor_codes"] = [f.code for f in factors]
    _record(state, "explain", {"codes": state["factor_codes"]})
    return state


def node_decide(state: AssessmentState) -> AssessmentState:
    """Two decisions, and they are deliberately decided differently.

    WHETHER TO ALERT: risk band only, exactly as contract §6 specifies. Not
    escalation_risk, not the predicted cadence — a prioritisation aid must never
    be what decides whether a human is told.

    WHEN TO CALL BACK: predicted per conversation by `services/cadence.py` from
    this call's own evidence, then clamped to the band's bounds. The §6 interval
    table is the guardrail, not the answer: a case that showed a new incident
    gets seen sooner than the table says, and no amount of protective context can
    stretch a dangerous case past its cap.
    """
    band = state["band"]

    state["needs_alert"] = band in ALERTING_BANDS

    base = baseline_svc.BaselineResult(
        baseline=state["baseline"],
        confidence=state["baseline_confidence"],  # type: ignore[arg-type]
        deviation=state["baseline_deviation"],
        sample_size=len(state["priors"]),
    )
    cadence = cadence_svc.predict_interval(
        state["signals"],
        band=band,
        baseline=base,
        change=state["change"],
        direction=state["direction"],
        priors=state["priors"],
    )

    state["cadence_hours"] = cadence.hours
    state["cadence_base_hours"] = cadence.base_hours
    state["cadence_clamped"] = cadence.clamped
    state["cadence_factors"] = cadence_svc.factors_to_json(cadence)
    state["follow_up_days"] = cadence.days
    state["follow_up_at"] = state["now"] + timedelta(hours=cadence.hours)
    state["follow_up_reason"] = cadence_svc.reason_for(band, cadence, state["direction"])

    _record(state, "decide", {
        "band": band,
        "alert": state["needs_alert"],
        "cadence_hours": cadence.hours,
        "cadence_base_hours": cadence.base_hours,
        "cadence_clamped": cadence.clamped,
        "cadence_codes": [f.code for f in cadence.factors],
        "cadence_version": cadence_svc.VERSION,
    }, to_state=band)
    return state


NODES: dict[str, Callable[[AssessmentState], AssessmentState]] = {
    "ingest": node_ingest,
    "extract": node_extract,
    "score": node_score,
    "baseline": node_baseline,
    "risk": node_risk,
    "predict": node_predict,
    "explain": node_explain,
    "decide": node_decide,
}


# --------------------------------------------------------------------------
# Graph construction
# --------------------------------------------------------------------------

_COMPILED: Any = None


def build_graph() -> Any:
    """Compile the LangGraph StateGraph. Cached — compilation is not free.

    Raises ImportError when LangGraph is unavailable; callers fall back to
    `run_sequential`.
    """
    global _COMPILED
    if _COMPILED is not None:
        return _COMPILED

    from langgraph.graph import END, START, StateGraph

    builder = StateGraph(AssessmentState)
    for name, fn in NODES.items():
        builder.add_node(name, fn)

    builder.add_edge(START, NODE_SEQUENCE[0])
    for earlier, later in zip(NODE_SEQUENCE, NODE_SEQUENCE[1:]):
        builder.add_edge(earlier, later)
    builder.add_edge(NODE_SEQUENCE[-1], END)

    _COMPILED = builder.compile()
    logger.info("langgraph assessment workflow compiled version=%s", GRAPH_VERSION)
    return _COMPILED


def run_sequential(state: AssessmentState) -> AssessmentState:
    """Walk the same nodes in the same order without LangGraph.

    The fallback path. Identical semantics by construction: it iterates
    NODE_SEQUENCE over the same NODES table the graph is built from, so the two
    executors cannot drift apart.
    """
    for name in NODE_SEQUENCE:
        state = NODES[name](state)
    return state


def run_workflow(state: AssessmentState) -> AssessmentState:
    """Run the assessment workflow, preferring LangGraph.

    A graph failure degrades to the sequential executor rather than failing the
    check-in: a report is a person's safety record, not a nice-to-have.
    """
    try:
        graph = build_graph()
    except ImportError:
        logger.warning("langgraph unavailable — running sequential executor")
        return run_sequential(state)

    try:
        result = graph.invoke(state)
    except Exception:  # noqa: BLE001 — orchestration failure must not lose a report
        logger.exception("langgraph invoke failed — falling back to sequential")
        return run_sequential(state)

    # LangGraph returns a plain dict of the final state.
    return dict(result)  # type: ignore[return-value]


__all__ = [
    "AssessmentState",
    "GRAPH_VERSION",
    "NODE_SEQUENCE",
    "NODES",
    "ALERTING_BANDS",
    "FOLLOWUP_DAYS",
    "build_graph",
    "run_sequential",
    "run_workflow",
]
