"""Golden tests for the LangGraph assessment workflow — contract §6.

Two properties matter here, and they are the reason the graph exists as its own
module rather than living inside the persistence layer:

  1. The graph produces the SAME numbers the pure services produce. It must add
     nothing and round nothing. If these tests drift, the graph has started
     computing, which contract rule 1 forbids.

  2. The LangGraph executor and the sequential fallback agree exactly. A missing
     dependency changes performance, never a person's risk band.

No database, no network, no LLM. `now` is injected.

Run:  cd backend && python -m pytest tests/ -v
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app.services import baseline as baseline_svc
from app.services import cadence as cadence_svc
from app.services import explain as explain_svc
from app.services import graph as graph_svc
from app.services import risk as risk_svc
from app.services import scoring as scoring_svc
from app.services.signals import PriorReport, signal_set_from_dict

FIXED_NOW = datetime(2026, 3, 1, 9, 30, tzinfo=timezone.utc)


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------

def raw(distress=None, threat=None, protective=None, crisis=None, engagement=None):
    """A §1-shaped payload with only the named signals present."""
    def block(d):
        return {
            k: {"present": True, "intensity": v, "evidence": f"test:{k}"}
            for k, v in (d or {}).items()
        }

    return {
        "schema_version": "1.0.0",
        "language_detected": "hi",
        "distress_signals": block(distress),
        "threat_signals": block(threat),
        "protective_signals": block(protective),
        "engagement": engagement or {
            "turn_count": 6, "avg_user_chars": 120.0,
            "disclosure_depth": "MEDIUM", "cooperativeness": 0.8,
        },
        "crisis": crisis or {
            "imminent_danger": False, "suicidal_intent": False, "trigger_quote": "",
        },
        "summary": "test",
    }


# Signal sets chosen to land in a specific band under §2 + §4. Defined once and
# shared, so the band parametrisations below cannot drift apart from each other.
#
#   MODERATE needs distress >= 40:  (1.0×1.0 + 0.7×1.0 + 0.8×0.5 + 0.6×1.0)
#                                   = 2.7 → 100×2.7/6.5 = 41.5
#   CRITICAL needs threat  >= 70:   (1.0 + 1.0 + 0.9 + 0.9 + 0.8)
#                                   = 4.6 → 100×4.6/6.2 = 74.2
MODERATE_DISTRESS = {
    "hopelessness": 1.0,
    "sadness_low_mood": 1.0,
    "anxiety_fear": 0.5,
    "sleep_disturbance": 1.0,
}
CRITICAL_THREAT = {
    "direct_threat_received": 1.0,
    "new_incident_reported": 1.0,
    "unsafe_at_home": 1.0,
    "intimidation_pressure": 1.0,
    "perpetrator_proximity": 1.0,
}


def priors(*scores: float) -> list[PriorReport]:
    return [
        PriorReport(report_version=i + 1, distress_score=s, threat_score=0.0, avg_user_chars=100.0)
        for i, s in enumerate(scores)
    ]


def state(raw_signals, prior_list=None, channel="TEXT"):
    return {
        "raw_signals": raw_signals,
        "priors": prior_list or [],
        "now": FIXED_NOW,
        "channel": channel,
    }


def langgraph_installed() -> bool:
    try:
        import langgraph  # noqa: F401
    except ImportError:
        return False
    return True


requires_langgraph = pytest.mark.skipif(
    not langgraph_installed(), reason="langgraph not installed"
)


# --------------------------------------------------------------------------
# The graph computes nothing: every value must match the pure service
# --------------------------------------------------------------------------

def test_graph_scores_match_pure_scoring_exactly():
    payload = raw(
        distress={"hopelessness": 0.8, "sleep_disturbance": 0.6, "anxiety_fear": 0.5},
        threat={"unsafe_at_home": 0.7, "intimidation_pressure": 0.4},
    )
    out = graph_svc.run_sequential(state(payload))

    signals = signal_set_from_dict(payload)
    d, t, c = scoring_svc.score_all(signals)

    assert out["distress"] == d
    assert out["threat"] == t
    assert out["composite"] == c


def test_graph_baseline_and_trend_match_pure_service():
    payload = raw(distress={"hopelessness": 1.0, "anxiety_fear": 1.0})
    history = priors(20.0, 24.0, 28.0)
    out = graph_svc.run_sequential(state(payload, history))

    distress = out["distress"]
    base = baseline_svc.compute_baseline(distress, history)
    trend, change = baseline_svc.compute_trend(distress, history)

    assert out["baseline"] == base.baseline
    assert out["baseline_confidence"] == base.confidence
    assert out["baseline_deviation"] == base.deviation
    assert out["trend"] == trend
    assert out["change"] == change
    assert out["previous_score"] == 28.0


def test_graph_band_and_prediction_match_pure_service():
    payload = raw(distress={"hopelessness": 0.9, "sadness_low_mood": 0.8})
    history = priors(30.0, 38.0, 46.0)
    out = graph_svc.run_sequential(state(payload, history))

    signals = signal_set_from_dict(payload)
    d, t, c = scoring_svc.score_all(signals)

    assert out["band"] == risk_svc.band(d, t, signals)
    prediction = risk_svc.predict(d, t, c, history)
    assert out["direction"] == prediction.direction
    assert out["escalation_risk"] == prediction.escalation_risk
    assert out["slope"] == prediction.slope
    assert out["horizon"] == prediction.horizon


def test_graph_factors_match_rule_table():
    """Factors are derived, never authored — contract rule 4."""
    payload = raw(
        distress={"self_harm_ideation": 0.7, "hopelessness": 0.8},
        threat={"direct_threat_received": 0.9},
    )
    history = priors(20.0, 22.0)
    out = graph_svc.run_sequential(state(payload, history))

    signals = signal_set_from_dict(payload)
    d, t, c = scoring_svc.score_all(signals)
    base = baseline_svc.compute_baseline(d, history)
    trend, change = baseline_svc.compute_trend(d, history)
    prediction = risk_svc.predict(d, t, c, history)

    expected = explain_svc.factors_to_json(
        explain_svc.build_factors(
            signals,
            distress=d, threat=t, baseline=base, change=change,
            has_previous=True, direction=prediction.direction, priors=history,
        )
    )
    assert out["factors"] == expected


# --------------------------------------------------------------------------
# §6 decide — driven by risk band only
# --------------------------------------------------------------------------

@pytest.mark.parametrize(
    "payload,expected_band,expected_alert",
    [
        (raw(), "LOW", False),
        (raw(distress=MODERATE_DISTRESS), "MODERATE", False),
        (raw(threat=CRITICAL_THREAT), "CRITICAL", True),
        (raw(crisis={"imminent_danger": True, "suicidal_intent": False,
                     "trigger_quote": "q"}), "URGENT", True),
    ],
)
def test_alerting_is_decided_by_band_alone(payload, expected_band, expected_alert):
    """Whether a human is told is band-driven — contract §6, unchanged.

    The cadence prediction must never be what decides this.
    """
    out = graph_svc.run_sequential(state(payload))
    assert out["band"] == expected_band
    assert out["needs_alert"] is expected_alert


@pytest.mark.parametrize("band_payload", [
    raw(),
    raw(distress=MODERATE_DISTRESS),
    raw(threat=CRITICAL_THREAT),
    raw(crisis={"imminent_danger": True, "suicidal_intent": False, "trigger_quote": "q"}),
])
def test_followup_date_comes_from_the_predicted_interval(band_payload):
    """The graph must schedule exactly what cadence predicted — no re-derivation.

    Interval values themselves are golden-tested in test_cadence.py; here we only
    check the wiring, so the two files cannot disagree about arithmetic.
    """
    out = graph_svc.run_sequential(state(band_payload))
    hours = out["cadence_hours"]

    assert out["follow_up_at"] == FIXED_NOW + timedelta(hours=hours)
    assert out["follow_up_days"] == pytest.approx(hours / 24.0, abs=0.01)

    low, high = cadence_svc.BOUNDS_HOURS[out["band"]]
    assert low <= hours <= high


def test_predicted_interval_matches_the_pure_cadence_service():
    payload = raw(
        distress={"hopelessness": 0.8, "self_harm_ideation": 0.6},
        threat={"new_incident_reported": 0.7},
    )
    history = priors(30.0, 38.0, 46.0)
    out = graph_svc.run_sequential(state(payload, history))

    signals = signal_set_from_dict(payload)
    d, t, c = scoring_svc.score_all(signals)
    base = baseline_svc.compute_baseline(d, history)
    _, change = baseline_svc.compute_trend(d, history)
    prediction = risk_svc.predict(d, t, c, history)

    expected = cadence_svc.predict_interval(
        signals,
        band=risk_svc.band(d, t, signals),
        baseline=base,
        change=change,
        direction=prediction.direction,
        priors=history,
    )
    assert out["cadence_hours"] == expected.hours
    assert out["cadence_factors"] == cadence_svc.factors_to_json(expected)


def test_cadence_reacts_to_the_conversation_not_only_the_band():
    """Two check-ins in the SAME band must not get the same date when the
    evidence differs. This is the whole point of predicting the interval."""
    calm = raw(distress=MODERATE_DISTRESS)
    same_band_but_worse = raw(
        distress=MODERATE_DISTRESS,
        # Threat 12.9 — nowhere near the MODERATE→HIGH boundary at 30, so the
        # band is unchanged and only the cadence rules can react to it.
        threat={"new_incident_reported": 0.8},
    )
    history = priors(45.0, 45.0, 45.0)

    a = graph_svc.run_sequential(state(calm, history))
    b = graph_svc.run_sequential(state(same_band_but_worse, history))

    assert a["band"] == b["band"] == "MODERATE"
    assert b["cadence_hours"] < a["cadence_hours"]


def test_escalating_trajectory_annotates_followup_reason():
    payload = raw(distress={"hopelessness": 1.0, "anxiety_fear": 1.0, "sadness_low_mood": 1.0})
    out = graph_svc.run_sequential(state(payload, priors(20.0, 30.0, 40.0)))
    assert out["direction"] == "ESCALATING"
    assert "escalating trajectory" in out["follow_up_reason"]
    assert "predicted" in out["follow_up_reason"]


def test_report_version_increments_from_priors():
    assert graph_svc.run_sequential(state(raw()))["report_version"] == 1
    assert graph_svc.run_sequential(state(raw(), priors(10.0, 20.0)))["report_version"] == 3


# --------------------------------------------------------------------------
# audit trail
# --------------------------------------------------------------------------

def test_every_node_records_an_event_in_order():
    out = graph_svc.run_sequential(state(raw()))
    assert [e["node"] for e in out["events"]] == list(graph_svc.NODE_SEQUENCE)


def test_risk_and_decide_events_carry_the_band_as_to_state():
    out = graph_svc.run_sequential(state(raw(crisis={
        "imminent_danger": True, "suicidal_intent": False, "trigger_quote": "q"
    })))
    by_node = {e["node"]: e for e in out["events"]}
    assert by_node["risk"]["to_state"] == "URGENT"
    assert by_node["decide"]["to_state"] == "URGENT"


# --------------------------------------------------------------------------
# determinism, and executor equivalence
# --------------------------------------------------------------------------

def _comparable(out: dict) -> dict:
    """Drop the typed SignalSet; compare the values that get persisted."""
    return {k: v for k, v in out.items() if k != "signals"}


def test_same_input_produces_identical_output():
    payload = raw(
        distress={"hopelessness": 0.7, "sleep_disturbance": 0.55},
        threat={"perpetrator_proximity": 0.6},
        protective={"family_support": 0.5},
    )
    history = priors(31.0, 35.0, 42.0)
    first = graph_svc.run_sequential(state(payload, history))
    second = graph_svc.run_sequential(state(payload, history))
    assert _comparable(first) == _comparable(second)


@requires_langgraph
def test_langgraph_executor_matches_sequential_executor():
    """The whole point of the fallback: it must not change a single value."""
    payload = raw(
        distress={"hopelessness": 0.9, "self_harm_ideation": 0.6, "anxiety_fear": 0.4},
        threat={"unsafe_at_home": 0.8, "institutional_inaction": 0.3},
        protective={"legal_progress": 0.4},
    )
    history = priors(25.0, 33.0, 41.0, 48.0)

    graphed = graph_svc.run_workflow(state(payload, history))
    sequential = graph_svc.run_sequential(state(payload, history))
    assert _comparable(graphed) == _comparable(sequential)


@requires_langgraph
def test_graph_compiles_with_the_contract_node_sequence():
    graph_svc.build_graph()  # must not raise
    assert graph_svc.NODE_SEQUENCE == (
        "ingest", "extract", "score", "baseline",
        "risk", "predict", "explain", "decide",
    )


def test_run_workflow_falls_back_when_graph_unavailable(monkeypatch):
    """A LangGraph failure must still produce a full assessment."""
    def boom():
        raise ImportError("simulated missing langgraph")

    monkeypatch.setattr(graph_svc, "build_graph", boom)
    out = graph_svc.run_workflow(state(raw(distress={"hopelessness": 0.9})))
    assert out["band"] != ""
    assert [e["node"] for e in out["events"]] == list(graph_svc.NODE_SEQUENCE)


def test_run_workflow_falls_back_when_invoke_raises(monkeypatch):
    class Exploding:
        def invoke(self, _state):
            raise RuntimeError("simulated graph failure")

    monkeypatch.setattr(graph_svc, "build_graph", lambda: Exploding())
    out = graph_svc.run_workflow(state(raw(distress={"hopelessness": 0.9})))
    assert [e["node"] for e in out["events"]] == list(graph_svc.NODE_SEQUENCE)


# --------------------------------------------------------------------------
# the graph must not read the wall clock
# --------------------------------------------------------------------------

def test_followup_is_derived_from_injected_now_only():
    other = datetime(2030, 12, 25, 4, 5, tzinfo=timezone.utc)
    s = state(raw())
    s["now"] = other
    out = graph_svc.run_sequential(s)
    assert out["follow_up_at"] == other + timedelta(hours=out["cadence_hours"])
