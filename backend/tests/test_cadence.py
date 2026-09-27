"""Golden tests for predicted follow-up cadence.

The interval decides how long someone in danger waits for the next contact, so
the properties under test are safety properties, not conveniences:

  1. Determinism — same conversation, same interval, always. It is arithmetic, not
     a model call, precisely so it can be defended and reproduced.
  2. The band cap is absolute. No combination of protective signals can stretch a
     dangerous case past its bound.
  3. Evidence moves the date. A new incident brings the call forward even when the
     band's table interval would not.

Expected values are hand-computed from the multiplier table in cadence.py. If a
multiplier changes, recompute by hand — never paste in what the code returns.

Run:  cd backend && python -m pytest tests/ -v
"""

from __future__ import annotations

import pytest

from app.services.baseline import BaselineResult, compute_baseline, compute_trend
from app.services.cadence import (
    BASE_HOURS,
    BOUNDS_HOURS,
    ROUND_TO_HOURS,
    factors_to_json,
    predict_interval,
    reason_for,
)
from app.services.signals import PriorReport, signal_set_from_dict

DAY = 24.0


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------

def sig(distress=None, threat=None, protective=None, crisis=None, engagement=None):
    def block(d):
        return {
            k: {"present": True, "intensity": v, "evidence": f"test:{k}"}
            for k, v in (d or {}).items()
        }

    return signal_set_from_dict(
        {
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
    )


def priors(*scores: float, chars: float = 120.0) -> list[PriorReport]:
    return [
        PriorReport(report_version=i + 1, distress_score=s, threat_score=0.0, avg_user_chars=chars)
        for i, s in enumerate(scores)
    ]


def steady_baseline(confidence="MEDIUM", deviation=0.0, n=3) -> BaselineResult:
    """A baseline that fires no rules of its own, to isolate what is under test."""
    return BaselineResult(baseline=40.0, confidence=confidence, deviation=deviation, sample_size=n)


def call(signals, *, band="MODERATE", baseline=None, change=0.0,
         direction="STABLE", prior_list=None):
    return predict_interval(
        signals,
        band=band,
        baseline=baseline or steady_baseline(),
        change=change,
        direction=direction,
        priors=prior_list if prior_list is not None else priors(40.0, 40.0, 40.0),
    )


def codes(result) -> list[str]:
    return [f.code for f in result.factors]


# --------------------------------------------------------------------------
# the neutral case: no evidence either way → the contract's own interval
# --------------------------------------------------------------------------

@pytest.mark.parametrize(
    "band,expected_hours",
    [("LOW", 14 * DAY), ("MODERATE", 7 * DAY), ("HIGH", 3 * DAY),
     ("CRITICAL", 1 * DAY), ("URGENT", 1 * DAY)],
)
def test_neutral_conversation_returns_the_contract_interval(band, expected_hours):
    """With nothing to adjust for, the prediction must equal contract §6."""
    result = call(sig(), band=band)
    assert result.factors == ()
    assert result.hours == expected_hours


def test_base_hours_match_the_contract_table():
    assert BASE_HOURS == {
        "URGENT": 24.0, "CRITICAL": 24.0, "HIGH": 72.0,
        "MODERATE": 168.0, "LOW": 336.0,
    }


# --------------------------------------------------------------------------
# evidence tightens the interval
# --------------------------------------------------------------------------

def test_new_incident_brings_the_call_forward():
    """168h × 0.6 = 100.8 → 16.8 steps → 17 → 102h (4d 6h).

    Note the rule fires on ANY present new_incident_reported, not at ≥0.5:
    something new having happened is not a matter of degree.
    """
    result = call(sig(threat={"new_incident_reported": 0.6}), band="MODERATE")
    assert codes(result) == ["CADENCE_NEW_THREAT"]
    assert result.hours == 102.0
    assert result.hours < BASE_HOURS["MODERATE"]


def test_a_faint_new_incident_still_fires():
    """intensity 0.1 — mentioned in passing — still counts as something new."""
    result = call(sig(threat={"new_incident_reported": 0.1}), band="LOW")
    assert "CADENCE_NEW_THREAT" in codes(result)


def test_escalating_trajectory_halves_the_interval():
    """7d × 0.5 = 84h exactly (3d 12h)."""
    result = call(sig(), band="MODERATE", direction="ESCALATING")
    assert codes(result) == ["CADENCE_ESCALATING"]
    assert result.hours == 84.0


def test_self_harm_ideation_halves_the_interval():
    """168h × 0.5 = 84h. Only CADENCE_SELF_HARM fires — hopelessness is unset."""
    result = call(sig(distress={"self_harm_ideation": 0.7}), band="MODERATE")
    assert codes(result) == ["CADENCE_SELF_HARM"]
    assert result.hours == 84.0


def test_multiple_concerns_compound():
    """168h × 0.5 (escalating) × 0.6 (new threat) = 50.4 → 8.4 steps → 8 → 48h."""
    result = call(
        sig(threat={"new_incident_reported": 0.8}),
        band="MODERATE",
        direction="ESCALATING",
    )
    assert codes(result) == ["CADENCE_ESCALATING", "CADENCE_NEW_THREAT"]
    assert result.hours == 48.0


def test_declining_engagement_tightens_the_interval():
    """Withdrawal is deterioration: the quiet check-in is the warning."""
    quiet = sig(engagement={
        "turn_count": 2, "avg_user_chars": 20.0,
        "disclosure_depth": "LOW", "cooperativeness": 0.9,
    })
    result = call(quiet, band="MODERATE", prior_list=priors(40.0, 40.0, chars=200.0))
    assert "CADENCE_ENGAGEMENT_DECLINED" in codes(result)
    assert result.hours < BASE_HOURS["MODERATE"]


def test_unestablished_baseline_tightens_the_interval():
    """A weak assessment is a reason to look again sooner, not to trust it."""
    result = call(sig(), band="MODERATE", baseline=steady_baseline("NONE", 0.0, 0),
                  prior_list=[])
    assert "CADENCE_BASELINE_UNRELIABLE" in codes(result)
    assert result.hours < BASE_HOURS["MODERATE"]


def test_above_baseline_tightens_the_interval():
    """168h × 0.7 = 117.6 → 117.6/6 = 19.6 → 20 steps → 120h (5d)."""
    result = call(sig(), band="MODERATE", baseline=steady_baseline("MEDIUM", 15.0))
    assert "CADENCE_ABOVE_BASELINE" in codes(result)
    assert result.hours == 120.0


def test_deviation_rules_do_not_fire_without_a_baseline():
    """Deviation is meaningless at confidence NONE, so it must not move the date."""
    result = call(sig(), band="MODERATE",
                  baseline=BaselineResult(baseline=40.0, confidence="NONE",
                                          deviation=30.0, sample_size=0),
                  prior_list=[])
    assert "CADENCE_ABOVE_BASELINE" not in codes(result)


# --------------------------------------------------------------------------
# improvement loosens it — but only within the cap
# --------------------------------------------------------------------------

def test_de_escalating_loosens_the_interval():
    """14d × 1.25 = 420h, capped at the LOW bound of 336h."""
    result = call(sig(), band="LOW", direction="DE_ESCALATING")
    assert result.hours == 336.0
    assert result.clamped


def test_protective_support_loosens_within_the_band():
    """3d × 1.15 = 82.8h → 84h, inside HIGH's 4-day cap."""
    result = call(sig(protective={"family_support": 0.8}), band="HIGH")
    assert "CADENCE_PROTECTIVE_SUPPORT" in codes(result)
    assert result.hours == 84.0


# --------------------------------------------------------------------------
# THE SAFETY PROPERTY: the cap is absolute
# --------------------------------------------------------------------------

def test_protective_signals_can_never_stretch_a_critical_case():
    """Emotional support does not reduce danger, and must not delay the call.

    Every loosening rule fires at once: 24h × 1.25 (de-escalating) × 1.15 (below
    baseline) × 1.1 (distress fell) × 1.15 (protective support) × 1.1 (legal
    progress) = 48.29h → 48h on the grid, exactly CRITICAL's 2-day ceiling.

    The band's cap is what makes this safe in general — see
    test_interval_always_lands_within_the_band_bounds for the exhaustive case.
    """
    result = call(
        sig(protective={
            "family_support": 1.0, "community_support": 1.0,
            "legal_progress": 1.0, "engagement_with_services": 1.0,
        }),
        band="CRITICAL",
        baseline=steady_baseline("HIGH", -20.0),
        change=-15.0,
        direction="DE_ESCALATING",
    )
    assert result.hours <= BOUNDS_HOURS["CRITICAL"][1]
    assert result.hours == 48.0


@pytest.mark.parametrize("band", ["URGENT", "CRITICAL", "HIGH", "MODERATE", "LOW"])
def test_interval_always_lands_within_the_band_bounds(band):
    """Exhaustive over the extremes: nothing escapes the guardrail."""
    everything_worse = sig(
        distress={"self_harm_ideation": 1.0, "hopelessness": 1.0},
        threat={"new_incident_reported": 1.0, "direct_threat_received": 1.0,
                "unsafe_at_home": 1.0, "perpetrator_proximity": 1.0},
        engagement={"turn_count": 1, "avg_user_chars": 5.0,
                    "disclosure_depth": "LOW", "cooperativeness": 0.1},
    )
    everything_better = sig(protective={
        "family_support": 1.0, "community_support": 1.0,
        "legal_progress": 1.0, "engagement_with_services": 1.0,
    })
    low, high = BOUNDS_HOURS[band]

    tight = call(everything_worse, band=band, direction="ESCALATING",
                 baseline=steady_baseline("MEDIUM", 25.0), change=20.0,
                 prior_list=priors(20.0, 30.0, 40.0, chars=300.0))
    loose = call(everything_better, band=band, direction="DE_ESCALATING",
                 baseline=steady_baseline("HIGH", -25.0), change=-20.0)

    assert low <= tight.hours <= high
    assert low <= loose.hours <= high


def test_urgent_is_never_more_than_a_day_out():
    """The tightest guarantee in the system."""
    for direction in ("ESCALATING", "STABLE", "DE_ESCALATING"):
        result = call(sig(protective={"family_support": 1.0}), band="URGENT",
                      direction=direction)
        assert result.hours <= 24.0


def test_tightening_never_schedules_a_call_within_hours():
    """A pile-up of concerns must not read as harassment."""
    result = call(
        sig(distress={"self_harm_ideation": 1.0, "hopelessness": 1.0},
            threat={"new_incident_reported": 1.0, "direct_threat_received": 1.0,
                    "unsafe_at_home": 1.0, "perpetrator_proximity": 1.0}),
        band="URGENT",
        direction="ESCALATING",
        baseline=steady_baseline("MEDIUM", 30.0),
        change=25.0,
    )
    assert result.hours >= BOUNDS_HOURS["URGENT"][0]
    assert result.clamped


# --------------------------------------------------------------------------
# determinism and shape
# --------------------------------------------------------------------------

def test_identical_input_gives_identical_output():
    args = dict(
        band="HIGH",
        baseline=steady_baseline("MEDIUM", 12.0),
        change=9.0,
        direction="ESCALATING",
        priors=priors(30.0, 38.0, 46.0),
    )
    signals = sig(distress={"hopelessness": 0.7}, threat={"unsafe_at_home": 0.6})
    first = predict_interval(signals, **args)
    second = predict_interval(signals, **args)
    assert first == second


def test_bounds_are_on_the_rounding_grid():
    """predict_interval clamps without re-stepping, which is only safe while every
    bound is a multiple of the step. If this fails, the `clamped` flag starts
    lying — fix the bound, not this test."""
    for low, high in BOUNDS_HOURS.values():
        assert low % ROUND_TO_HOURS == 0
        assert high % ROUND_TO_HOURS == 0


def test_clamped_is_false_when_evidence_set_the_date():
    """The flag must mean "the cap decided this", not "a cap exists"."""
    assert call(sig(), band="MODERATE").clamped is False
    assert call(sig(), band="MODERATE", direction="ESCALATING").clamped is False


def test_interval_is_always_on_the_rounding_grid():
    """6-hour steps: predicting "4.37 days" implies precision this does not have."""
    for band in BASE_HOURS:
        result = call(sig(distress={"hopelessness": 0.6}), band=band,
                      direction="ESCALATING")
        assert result.hours % ROUND_TO_HOURS == 0


def test_factors_serialise_with_code_label_and_multiplier():
    result = call(sig(threat={"new_incident_reported": 0.7}), band="HIGH")
    payload = factors_to_json(result)
    assert payload
    for entry in payload:
        assert set(entry) == {"code", "label", "multiplier"}
        assert entry["label"] and not entry["label"].startswith("CADENCE_")


def test_describe_reads_as_a_real_interval():
    assert call(sig(), band="MODERATE").describe() == "7d"
    assert call(sig(), band="CRITICAL").describe() == "1d"
    # 7d × 0.6 = 100.8 → 102h = 4d 6h
    assert call(sig(threat={"new_incident_reported": 0.6}), band="MODERATE").describe() == "4d 6h"


# --------------------------------------------------------------------------
# the reason string — what a caseworker reads
# --------------------------------------------------------------------------

def test_reason_names_the_predicted_interval():
    result = call(sig(threat={"new_incident_reported": 0.7}), band="HIGH")
    reason = reason_for("HIGH", result, "STABLE")
    assert "High risk" in reason
    assert "predicted" in reason
    assert result.describe() in reason


def test_reason_says_when_the_cap_set_the_date():
    """A caseworker should know the guardrail decided this, not the evidence."""
    result = call(sig(), band="LOW", direction="DE_ESCALATING")
    assert "capped by band" in reason_for("LOW", result, "DE_ESCALATING")


def test_reason_flags_an_escalating_trajectory():
    result = call(sig(), band="HIGH", direction="ESCALATING")
    assert "escalating trajectory" in reason_for("HIGH", result, "ESCALATING")


def test_reason_fits_the_database_column():
    """FollowUp.reason is String(255)."""
    result = call(
        sig(distress={"self_harm_ideation": 1.0, "hopelessness": 1.0},
            threat={"new_incident_reported": 1.0}),
        band="URGENT", direction="ESCALATING",
    )
    assert len(reason_for("URGENT", result, "ESCALATING")) <= 255


# --------------------------------------------------------------------------
# integration with the real pure services
# --------------------------------------------------------------------------

def test_works_with_real_baseline_and_trend_output():
    """No hand-built BaselineResult — the real functions, as the graph calls them.

    History 30/34/38, current 52: baseline = mean(30,34,38) = 34.0 at MEDIUM
    confidence, deviation = +18.0, change = 52 − 38 = +14.0.

    Rules fired: escalating (×0.5), above baseline (×0.7), distress rose (×0.8).
    72h × 0.5 × 0.7 × 0.8 = 20.16 → 18h on the grid, below HIGH's 24h floor, so
    the floor is what sets the date.
    """
    history = priors(30.0, 34.0, 38.0)
    current = 52.0
    base = compute_baseline(current, history)
    trend, change = compute_trend(current, history)

    assert base.baseline == 34.0
    assert base.confidence == "MEDIUM"
    assert change == 14.0
    assert trend == "WORSENING"

    result = predict_interval(
        sig(distress={"hopelessness": 0.7}),
        band="HIGH",
        baseline=base,
        change=change,
        direction="ESCALATING",
        priors=history,
    )
    assert codes(result) == [
        "CADENCE_ESCALATING",
        "CADENCE_ABOVE_BASELINE",
        "CADENCE_DISTRESS_ROSE",
        "CADENCE_HOPELESSNESS",
    ]
    assert result.hours == BOUNDS_HOURS["HIGH"][0] == 24.0
    assert result.clamped
