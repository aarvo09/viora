"""Tests for the Geographic Distress Hotspot service and endpoints.

Verifies:
- Pure math determinism for hotspot calculation.
- 4-person synthetic distribution across 3 administrative areas.
- Aggregation privacy (zero patient names/UIDs leaked).
- Endpoint accessibility and schema conformity.
"""

from fastapi.testclient import TestClient
import pytest

from app.core.database import SessionLocal
from app.main import app
from app.services.hotspot import calculate_hotspot_metrics, get_district_hotspots


def test_calculate_hotspot_metrics_empty():
    res = calculate_hotspot_metrics(
        active_cases=0,
        average_distress=0.0,
        average_threat=0.0,
        high_risk_cases=0,
        critical_cases=0,
        trend="STABLE",
    )
    assert res["hotspot_score"] == 0.0
    assert res["intensity"] == 0.0
    assert res["hotspot_level"] == "LOW"


def test_calculate_hotspot_metrics_high_intensity():
    res = calculate_hotspot_metrics(
        active_cases=2,
        average_distress=65.0,
        average_threat=40.0,
        high_risk_cases=1,
        critical_cases=0,
        trend="INCREASING",
        previous_average_distress=50.0,
    )
    assert res["hotspot_score"] >= 70.0
    assert res["intensity"] >= 0.70
    assert res["hotspot_level"] == "HIGH"
    assert res["trend"] == "INCREASING"
    assert res["recent_change_pct"] == 30.0  # (65-50)/50 * 100


def test_calculate_hotspot_metrics_low_intensity():
    res = calculate_hotspot_metrics(
        active_cases=1,
        average_distress=5.0,
        average_threat=0.0,
        high_risk_cases=0,
        critical_cases=0,
        trend="DECREASING",
        previous_average_distress=10.0,
    )
    assert res["hotspot_score"] < 40.0
    assert res["intensity"] < 0.40
    assert res["hotspot_level"] == "LOW"
    assert res["trend"] == "DECREASING"
    assert res["recent_change_pct"] == -50.0


def test_get_district_hotspots_distribution():
    db = SessionLocal()
    try:
        data = get_district_hotspots(db, district="Central District", time_range="30d")
        assert data["district"] == "Central District"
        assert data["total_active_cases"] == 4
        assert len(data["areas"]) == 3

        areas_by_id = {a["area_id"]: a for a in data["areas"]}
        assert "AREA_A" in areas_by_id
        assert "AREA_B" in areas_by_id
        assert "AREA_C" in areas_by_id

        # Distribution verification
        assert areas_by_id["AREA_A"]["active_cases"] == 2
        assert areas_by_id["AREA_B"]["active_cases"] == 1
        assert areas_by_id["AREA_C"]["active_cases"] == 1

        # Area A is visibly stronger hotspot
        assert areas_by_id["AREA_A"]["hotspot_score"] > areas_by_id["AREA_B"]["hotspot_score"]
        assert areas_by_id["AREA_A"]["hotspot_score"] > areas_by_id["AREA_C"]["hotspot_score"]
        assert areas_by_id["AREA_A"]["hotspot_level"] == "HIGH"

        # Privacy check: ensure no patient identifiers exist in response
        raw_str = str(data)
        assert "Meera" not in raw_str
        assert "Kavita" not in raw_str
        assert "Sunita" not in raw_str
        assert "Rahul" not in raw_str
        assert "VRA-" not in raw_str
        assert "CASE-" not in raw_str
    finally:
        db.close()


def test_geographic_hotspots_api_endpoints():
    client = TestClient(app)

    # Test /api/v1/district/geographic-hotspots
    resp1 = client.get("/api/v1/district/geographic-hotspots?time_range=30d")
    assert resp1.status_code == 200
    json1 = resp1.json()
    assert json1["district"] == "Central District"
    assert len(json1["areas"]) == 3
    assert "distress_trends" in json1

    # Test /api/district/geographic-hotspots alias
    resp2 = client.get("/api/district/geographic-hotspots?time_range=7d")
    assert resp2.status_code == 200
    json2 = resp2.json()
    assert json2["time_range"] == "7d"
    assert len(json2["areas"]) == 3
