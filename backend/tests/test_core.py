"""Golden tests for the deterministic core.

Determinism is a product requirement, so these assert EXACT values hand-computed
from docs/CONTRACT.md §2–§5 rather than approximate ranges. If a formula is
changed, these must be recomputed by hand — never "fixed" by pasting in whatever
the code now returns.

Run:  cd backend && python -m pytest tests/ -v
"""

from __future__ import annotations

import pytest

from app.services.baseline import compute_baseline, compute_trend, engagement_declined
from app.services.explain import build_factors
from app.services.risk import band, predict
from app.services.scoring import (
    W_SUM_DISTRESS,
    W_SUM_THREAT,
    composite_score,
    distress_score,
    protective_dampener,
    threat_score,
)
from app.services.signals import PriorReport, signal_set_from_dict


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------

def sig(distress=None, threat=None, protective=None, crisis=None, engagement=None):
    """Build a §1-shaped payload with only the named signals present."""
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
            "engagement": engagement or {"turn_count": 6, "avg_user_chars": 120.0,
                                         "disclosure_depth": "MEDIUM", "cooperativeness": 0.8},
            "crisis": crisis or {"imminent_danger": False, "suicidal_intent": False, "trigger_quote": ""},
            "summary": "test",
        }
    )


def priors(*scores: float) -> list[PriorReport]:
    return [
        PriorReport(report_version=i + 1, distress_score=s, threat_score=0.0, avg_user_chars=100.0)
        for i, s in enumerate(scores)
    ]


# --------------------------------------------------------------------------
# §2.1 distress
# --------------------------------------------------------------------------

def test_all_zero_signals_score_zero():
    s = sig()
    assert distress_score(s) == 0.0
    assert threat_score(s) == 0.0
    assert composite_score(0.0, 0.0) == 0.0


def test_single_distress_signal_at_full_intensity():
    # hopelessness weight 1.0 → 100 * 1.0 / 6.5 = 15.3846… → 15.4
    assert distress_score(sig(distress={"hopelessness": 1.0})) == 15.4


def test_all_distress_signals_max_gives_100():
    every = {k: 1.0 for k in (
        "hopelessness", "sadness_low_mood", "anxiety_fear", "sleep_disturbance",
        "appetite_change", "social_withdrawal", "somatic_complaints",
        "shame_stigma", "anger_irritability", "self_harm_ideation",
    )}
    assert distress_score(sig(distress=every)) == 100.0


def test_weight_sums_match_contract():
    from app.services.scoring import WEIGHTS_DISTRESS, WEIGHTS_THREAT
    assert round(sum(WEIGHTS_DISTRESS.values()), 6) == W_SUM_DISTRESS
    assert round(sum(WEIGHTS_THREAT.values()), 6) == W_SUM_THREAT


# --------------------------------------------------------------------------
# §2.1 self-harm hard floor — tested on BOTH sides of the boundary
# --------------------------------------------------------------------------

def test_self_harm_floor_applies_at_exactly_threshold():
    # 1.0 * 0.5 → 100*0.5/6.5 = 7.7, floored to 75.0
    assert distress_score(sig(distress={"self_harm_ideation": 0.5})) == 75.0


def test_self_harm_floor_does_not_apply_just_below_threshold():
    # 0.49 → 100*0.49/6.5 = 7.538… → 7.5, no floor
    assert distress_score(sig(distress={"self_harm_ideation": 0.49})) == 7.5


def test_self_harm_floor_does_not_lower_a_higher_score():
    """The floor is max(), not assignment — a worse picture must stay worse.

    Hand-computed: eight signals at 1.0 →
      hopelessness 1.0 + self_harm 1.0 + anxiety 0.8 + sadness 0.7
      + sleep 0.6 + withdrawal 0.6 + shame 0.5 + anger 0.5      = 5.7
      base = 100 * 5.7 / 6.5 = 87.692…  → 87.7
    Above the 75.0 floor, so the floor must leave it untouched.

    (Six signals would give 4.7/6.5 = 72.3, i.e. BELOW the floor — which tests
    the floor being applied, not the floor being ignored. That case is covered
    by test_self_harm_floor_applies_at_exactly_threshold.)
    """
    every = {k: 1.0 for k in ("hopelessness", "self_harm_ideation", "anxiety_fear",
                              "sadness_low_mood", "sleep_disturbance", "social_withdrawal",
                              "shame_stigma", "anger_irritability")}
    assert distress_score(sig(distress=every)) == 87.7


# --------------------------------------------------------------------------
# §2.1 protective dampening
# --------------------------------------------------------------------------

def test_no_protective_signals_means_no_dampening():
    assert protective_dampener(sig()) == 1.0


def test_one_protective_signal_dampens():
    s = sig(distress={"hopelessness": 1.0}, protective={"family_support": 1.0})
    # dampener = 1 - 0.15*1.0 = 0.85 → 15.3846… * 0.85 = 13.0769… → 13.1
    assert protective_dampener(s) == pytest.approx(0.85)
    assert distress_score(s) == 13.1


def test_four_protective_signals_use_mean_not_sum():
    s = sig(
        distress={"hopelessness": 1.0},
        protective={"family_support": 1.0, "community_support": 1.0,
                    "legal_progress": 1.0, "engagement_with_services": 1.0},
    )
    # mean of present intensities is 1.0, so dampener is still 0.85 — four
    # supports do not stack into a 60% discount.
    assert protective_dampener(s) == pytest.approx(0.85)
    assert distress_score(s) == 13.1


def test_partial_protective_intensity_dampens_proportionally():
    s = sig(distress={"hopelessness": 1.0}, protective={"family_support": 0.5})
    assert protective_dampener(s) == pytest.approx(0.925)
    assert distress_score(s) == 14.2  # 15.3846 * 0.925 = 14.2307 → 14.2


# --------------------------------------------------------------------------
# §2.2 threat
# --------------------------------------------------------------------------

def test_single_threat_signal():
    # direct_threat_received weight 1.0 → 100/6.2 = 16.129… → 16.1
    assert threat_score(sig(threat={"direct_threat_received": 1.0})) == 16.1


def test_imminent_danger_floors_threat_at_85():
    s = sig(crisis={"imminent_danger": True, "suicidal_intent": False, "trigger_quote": "q"})
    assert threat_score(s) == 85.0


def test_protective_signals_do_not_reduce_threat():
    """Emotional support does not reduce physical danger. Contract §2.2."""
    bare = sig(threat={"direct_threat_received": 1.0, "unsafe_at_home": 1.0})
    supported = sig(
        threat={"direct_threat_received": 1.0, "unsafe_at_home": 1.0},
        protective={"family_support": 1.0, "community_support": 1.0,
                    "legal_progress": 1.0, "engagement_with_services": 1.0},
    )
    assert threat_score(bare) == threat_score(supported)


# --------------------------------------------------------------------------
# §2.3 composite
# --------------------------------------------------------------------------

def test_composite_weights_the_higher_axis():
    assert composite_score(20.0, 80.0) == 62.0   # 80*0.7 + 20*0.3
    assert composite_score(80.0, 20.0) == 62.0   # symmetric


# --------------------------------------------------------------------------
# §3 baseline cold start
# --------------------------------------------------------------------------

def test_baseline_with_no_priors_is_none_confidence_and_zero_deviation():
    r = compute_baseline(55.0, priors())
    assert (r.baseline, r.confidence, r.deviation, r.sample_size) == (55.0, "NONE", 0.0, 0)


def test_baseline_with_one_prior_is_low_confidence():
    r = compute_baseline(50.0, priors(30.0))
    assert (r.baseline, r.confidence, r.deviation) == (30.0, "LOW", 20.0)


def test_baseline_with_two_priors_is_medium_confidence():
    r = compute_baseline(50.0, priors(30.0, 40.0))
    assert (r.baseline, r.confidence, r.deviation) == (35.0, "MEDIUM", 15.0)


def test_baseline_with_five_priors_is_high_confidence():
    r = compute_baseline(50.0, priors(10.0, 20.0, 30.0, 40.0, 50.0))
    assert (r.baseline, r.confidence, r.sample_size) == (30.0, "HIGH", 5)


def test_baseline_window_uses_only_five_most_recent():
    r = compute_baseline(50.0, priors(0.0, 0.0, 0.0, 10.0, 20.0, 30.0, 40.0, 50.0))
    assert r.baseline == 30.0  # mean of last five, ignoring the three zeros
    assert r.sample_size == 5


# --------------------------------------------------------------------------
# §3 trend boundaries
# --------------------------------------------------------------------------

def test_trend_insufficient_data_without_priors():
    assert compute_trend(50.0, priors()) == ("INSUFFICIENT_DATA", 0.0)


def test_trend_worsening_at_exactly_plus_eight():
    assert compute_trend(58.0, priors(50.0)) == ("WORSENING", 8.0)


def test_trend_stable_just_below_plus_eight():
    assert compute_trend(57.9, priors(50.0)) == ("STABLE", 7.9)


def test_trend_improving_at_exactly_minus_eight():
    assert compute_trend(42.0, priors(50.0)) == ("IMPROVING", -8.0)


def test_trend_stable_just_above_minus_eight():
    assert compute_trend(42.1, priors(50.0)) == ("STABLE", -7.9)


# --------------------------------------------------------------------------
# §4 risk bands — every boundary, both sides
# --------------------------------------------------------------------------

@pytest.mark.parametrize(
    "distress,threat,expected",
    [
        (0.0, 0.0, "LOW"),
        (39.9, 29.9, "LOW"),
        (40.0, 0.0, "MODERATE"),     # distress boundary
        (0.0, 30.0, "MODERATE"),     # threat boundary, lower than distress
        (59.9, 49.9, "MODERATE"),
        (60.0, 0.0, "HIGH"),
        (0.0, 50.0, "HIGH"),
        (79.9, 69.9, "HIGH"),
        (80.0, 0.0, "CRITICAL"),
        (0.0, 70.0, "CRITICAL"),
        (100.0, 100.0, "CRITICAL"),
    ],
)
def test_risk_band_boundaries(distress, threat, expected):
    assert band(distress, threat, sig()) == expected


def test_calm_person_under_severe_threat_still_escalates():
    """The case a single blended score would hide. Contract §2/§4."""
    assert band(5.0, 75.0, sig()) == "CRITICAL"


def test_crisis_overrides_every_other_band():
    s = sig(crisis={"imminent_danger": False, "suicidal_intent": True, "trigger_quote": "q"})
    assert band(0.0, 0.0, s) == "URGENT"


# --------------------------------------------------------------------------
# §4 prediction
# --------------------------------------------------------------------------

def test_prediction_insufficient_data_below_three_points():
    r = predict(50.0, 0.0, 35.0, priors(40.0))
    assert r.direction == "INSUFFICIENT_DATA"
    assert r.slope == 0.0
    assert r.sample_size == 2


def test_prediction_escalating_at_exactly_slope_four():
    # window [40, 44, 48] → slope exactly 4.0
    r = predict(48.0, 0.0, 48.0, priors(40.0, 44.0))
    assert r.slope == 4.0
    assert r.direction == "ESCALATING"


def test_prediction_stable_just_below_slope_four():
    # window [40, 43.9, 47.8] → slope 3.9
    r = predict(47.8, 0.0, 47.8, priors(40.0, 43.9))
    assert r.direction == "STABLE"


def test_prediction_de_escalating_at_minus_four():
    r = predict(40.0, 0.0, 40.0, priors(48.0, 44.0))
    assert r.slope == -4.0
    assert r.direction == "DE_ESCALATING"


def test_prediction_window_caps_at_four_points():
    r = predict(50.0, 0.0, 50.0, priors(10.0, 20.0, 30.0, 40.0, 45.0))
    assert r.sample_size == 4


# --------------------------------------------------------------------------
# §5 explanation factors
# --------------------------------------------------------------------------

def _factors(signals, distress=0.0, threat=0.0, prior_scores=(), change=0.0,
             has_previous=False, direction="STABLE"):
    p = priors(*prior_scores)
    return build_factors(
        signals,
        distress=distress,
        threat=threat,
        baseline=compute_baseline(distress, p),
        change=change,
        has_previous=has_previous,
        direction=direction,
        priors=p,
    )


def test_no_signals_yields_only_baseline_caveat():
    codes = [f.code for f in _factors(sig())]
    assert codes == ["BASELINE_UNRELIABLE"]


def test_factors_are_ordered_serious_then_concern_then_info():
    s = sig(
        distress={"self_harm_ideation": 0.9, "sleep_disturbance": 0.8},
        protective={"family_support": 0.9},
    )
    factors = _factors(s, distress=80.0, threat=0.0, prior_scores=(50.0, 55.0))
    severities = [f.severity for f in factors]
    assert severities == sorted(severities, key=lambda x: {"SERIOUS": 0, "CONCERN": 1, "INFO": 2}[x])
    assert factors[0].code == "SELF_HARM_IDEATION"


def test_baseline_deviation_factor_suppressed_when_confidence_is_none():
    """With no history a 'deviation' is meaningless and must not be claimed."""
    codes = [f.code for f in _factors(sig(), distress=90.0)]
    assert "DISTRESS_ABOVE_BASELINE" not in codes


def test_baseline_deviation_factor_fires_with_history():
    codes = [f.code for f in _factors(sig(), distress=70.0, prior_scores=(50.0, 52.0))]
    assert "DISTRESS_ABOVE_BASELINE" in codes


def test_every_factor_carries_a_code_and_severity():
    s = sig(
        distress={"hopelessness": 0.9, "self_harm_ideation": 0.7, "sleep_disturbance": 0.8},
        threat={"direct_threat_received": 0.9, "unsafe_at_home": 0.8, "intimidation_pressure": 0.7},
        crisis={"imminent_danger": True, "suicidal_intent": True, "trigger_quote": "q"},
    )
    for f in _factors(s, distress=85.0, threat=90.0, prior_scores=(40.0, 45.0), direction="ESCALATING"):
        assert f.code and f.severity in ("SERIOUS", "CONCERN", "INFO")


# --------------------------------------------------------------------------
# case isolation & determinism — both are product requirements
# --------------------------------------------------------------------------

def test_identical_input_is_stable_across_100_evaluations():
    s = sig(
        distress={"hopelessness": 0.7, "sleep_disturbance": 0.4, "anxiety_fear": 0.6},
        threat={"unsafe_at_home": 0.8, "perpetrator_proximity": 0.5},
        protective={"family_support": 0.3},
    )
    p = priors(30.0, 38.0, 44.0)
    first = (
        distress_score(s),
        threat_score(s),
        compute_baseline(distress_score(s), p).baseline,
        predict(distress_score(s), threat_score(s), 50.0, p).escalation_risk,
        [f.code for f in _factors(s, 50.0, 60.0, (30.0, 38.0, 44.0))],
    )
    for _ in range(100):
        assert (
            distress_score(s),
            threat_score(s),
            compute_baseline(distress_score(s), p).baseline,
            predict(distress_score(s), threat_score(s), 50.0, p).escalation_risk,
            [f.code for f in _factors(s, 50.0, 60.0, (30.0, 38.0, 44.0))],
        ) == first


def test_one_cases_history_cannot_affect_another():
    s = sig(distress={"hopelessness": 0.6})
    case_a = compute_baseline(distress_score(s), priors(10.0, 12.0, 11.0))
    case_b = compute_baseline(distress_score(s), priors(80.0, 85.0, 82.0))
    assert case_a.baseline != case_b.baseline
    assert case_a.baseline == 11.0 and case_b.baseline == pytest.approx(82.3, abs=0.05)


# --------------------------------------------------------------------------
# input hardening
# --------------------------------------------------------------------------

def test_absent_signal_with_stray_intensity_is_repaired_to_zero():
    s = signal_set_from_dict(
        {"distress_signals": {"hopelessness": {"present": False, "intensity": 0.9, "evidence": ""}}}
    )
    assert s.d("hopelessness") == 0.0
    assert distress_score(s) == 0.0


def test_missing_keys_default_rather_than_raise():
    s = signal_set_from_dict({})
    assert distress_score(s) == 0.0 and threat_score(s) == 0.0
    assert band(0.0, 0.0, s) == "LOW"


def test_out_of_range_intensity_is_clamped():
    s = signal_set_from_dict(
        {"distress_signals": {"hopelessness": {"present": True, "intensity": 5.0, "evidence": ""}}}
    )
    assert s.d("hopelessness") == 1.0


def test_engagement_decline_needs_at_least_two_priors():
    assert engagement_declined(10.0, priors(100.0)) is False
    assert engagement_declined(10.0, priors(100.0, 100.0)) is True
    assert engagement_declined(100.0, priors(100.0, 100.0)) is False
