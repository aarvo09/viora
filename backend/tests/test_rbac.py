"""Role-based access control tests — contract §8 roles.

The principle under test, and it is a safety principle rather than a security
one: READING a case is open to every authenticated staff role, because a DM, an
SP and a prosecutor all have legitimate reason to see that someone is in danger.
Roles gate WRITING — the accountable decisions.

Run:  cd backend && python -m pytest tests/ -v
"""

from __future__ import annotations

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from app.core.security import (
    ACKNOWLEDGE_ROLES,
    ADMIN_ROLES,
    ALL_ROLES,
    CASEWORK_ROLES,
    ESCALATION_ROLES,
    current_staff,
    hash_password,
    require_roles,
    verify_password,
)
from app.models import StaffUser


# --------------------------------------------------------------------------
# password hashing
# --------------------------------------------------------------------------

def test_password_roundtrip():
    hashed = hash_password("viora1234")
    assert hashed != "viora1234"
    assert verify_password("viora1234", hashed)
    assert not verify_password("viora1235", hashed)


def test_verify_password_survives_a_malformed_hash():
    """A corrupt hash must be a failed login, never a 500."""
    assert verify_password("anything", "not-a-bcrypt-hash") is False


def test_password_over_72_bytes_is_handled():
    """bcrypt truncates at 72 bytes; we truncate explicitly so it is consistent."""
    long_password = "a" * 200
    hashed = hash_password(long_password)
    assert verify_password(long_password, hashed)


# --------------------------------------------------------------------------
# require_roles
# --------------------------------------------------------------------------

def app_for(dependency) -> FastAPI:
    """A minimal app with one guarded route, so the dependency is tested alone."""
    app = FastAPI()

    @app.get("/guarded")
    def guarded(staff: StaffUser = Depends(dependency)) -> dict:
        return {"role": staff.role}

    return app


def client_as(role: str, dependency) -> TestClient:
    app = app_for(dependency)
    app.dependency_overrides[current_staff] = lambda: StaffUser(
        id=1, name="Test", email="t@viora.local", password_hash="x", role=role, is_active=True
    )
    return TestClient(app)


@pytest.mark.parametrize("role", CASEWORK_ROLES)
def test_casework_roles_may_do_casework(role):
    res = client_as(role, require_roles(*CASEWORK_ROLES)).get("/guarded")
    assert res.status_code == 200
    assert res.json()["role"] == role


@pytest.mark.parametrize("role", [r for r in ALL_ROLES if r not in CASEWORK_ROLES])
def test_non_casework_roles_are_refused_casework(role):
    res = client_as(role, require_roles(*CASEWORK_ROLES)).get("/guarded")
    assert res.status_code == 403


def test_refusal_is_403_not_401():
    """A valid session must not be bounced to the login screen.

    403 tells the dashboard "not your decision to make"; 401 would clear the
    token and log a caseworker out mid-task.
    """
    res = client_as("SPP", require_roles(*CASEWORK_ROLES)).get("/guarded")
    assert res.status_code == 403
    assert "not permitted" in res.json()["detail"]


def test_refusal_names_the_required_roles():
    """The message must be actionable — who to hand this to."""
    detail = client_as("SPP", require_roles("DSWO", "ADMIN")).get("/guarded").json()["detail"]
    assert "DSWO" in detail and "ADMIN" in detail


@pytest.mark.parametrize("role", ACKNOWLEDGE_ROLES)
def test_police_and_magistrate_may_acknowledge_alerts(role):
    """Acknowledging is deliberately wider than casework: danger is not only a
    caseworker's business."""
    assert client_as(role, require_roles(*ACKNOWLEDGE_ROLES)).get("/guarded").status_code == 200


def test_prosecutor_may_not_acknowledge_alerts():
    """SPP handles the legal track, not the protective response."""
    assert client_as("SPP", require_roles(*ACKNOWLEDGE_ROLES)).get("/guarded").status_code == 403


@pytest.mark.parametrize("role", ESCALATION_ROLES)
def test_escalation_roles_may_escalate(role):
    assert client_as(role, require_roles(*ESCALATION_ROLES)).get("/guarded").status_code == 200


def test_admin_only_gate_excludes_everyone_else():
    assert client_as("ADMIN", require_roles(*ADMIN_ROLES)).get("/guarded").status_code == 200
    for role in (r for r in ALL_ROLES if r != "ADMIN"):
        assert client_as(role, require_roles(*ADMIN_ROLES)).get("/guarded").status_code == 403


def test_unknown_role_is_refused():
    """Fail closed: a role that is not in the allowlist gets nothing."""
    assert client_as("INTERN", require_roles(*CASEWORK_ROLES)).get("/guarded").status_code == 403


def test_admin_is_in_every_write_gate():
    """ADMIN must never be locked out of an action it is meant to oversee."""
    for gate in (CASEWORK_ROLES, ACKNOWLEDGE_ROLES, ESCALATION_ROLES):
        assert "ADMIN" in gate
