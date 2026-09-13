"""Auth primitives for the counsellor dashboard.

The patient app has no login in this build — the phone selects a profile and
talks to the backend directly. Staff endpoints are the ones carrying a token.

Uses `bcrypt` and `PyJWT` directly rather than passlib/python-jose: both of
those are unmaintained and break on modern Python (passlib imports the `crypt`
module, removed in 3.13).
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

import bcrypt
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.config import settings
from app.core.database import get_db
from app.models import StaffUser

_bearer = HTTPBearer(auto_error=False)

# bcrypt truncates silently past 72 bytes; truncate explicitly so behaviour is
# the same whichever backend is used.
_MAX_PASSWORD_BYTES = 72


def _encode(plain: str) -> bytes:
    return plain.encode("utf-8")[:_MAX_PASSWORD_BYTES]


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(_encode(plain), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(_encode(plain), hashed.encode("utf-8"))
    except (ValueError, TypeError):
        # Malformed hash in the database — treat as a failed login, never a 500.
        return False


def create_access_token(staff: StaffUser) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    payload: dict[str, Any] = {
        "sub": str(staff.id),
        "email": staff.email,
        "role": staff.role,
        "exp": expire,
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def current_staff(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: Session = Depends(get_db),
) -> StaffUser:
    """Resolve the authenticated staff user, or 401."""
    unauthorized = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Not authenticated",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if creds is None or not creds.credentials:
        raise unauthorized
    try:
        payload = jwt.decode(
            creds.credentials, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM]
        )
        staff_id = int(payload.get("sub", 0))
    except (jwt.PyJWTError, ValueError, TypeError):
        raise unauthorized

    staff = db.get(StaffUser, staff_id)
    if staff is None or not staff.is_active:
        raise unauthorized
    return staff


# --------------------------------------------------------------------------
# Role-based access. Contract §8 roles: DSWO | DM | SP | SPP | ADMIN.
# --------------------------------------------------------------------------
#
# The design principle, and it is a safety one: READING a case is open to every
# authenticated staff role. A district magistrate, an SP and a public prosecutor
# all have legitimate reason to see that someone is in danger, and a role check
# that hides an URGENT alert from the person who could act on it would be worse
# than no check at all.
#
# What roles gate is WRITING — acknowledging an alert, recording a review
# outcome, ordering an intervention. Those are accountable decisions and the
# record needs to show who was entitled to make them.

ALL_ROLES: tuple[str, ...] = ("DSWO", "DM", "SP", "SPP", "ADMIN")

# Caseworkers and admins own day-to-day casework decisions.
CASEWORK_ROLES: tuple[str, ...] = ("DSWO", "ADMIN")

# Alert acknowledgement is wider: police and the magistrate act on danger too.
ACKNOWLEDGE_ROLES: tuple[str, ...] = ("DSWO", "SP", "DM", "ADMIN")

# Escalation to protection or relocation involves police and administration.
ESCALATION_ROLES: tuple[str, ...] = ("DSWO", "SP", "DM", "ADMIN")

ADMIN_ROLES: tuple[str, ...] = ("ADMIN",)


def require_roles(*roles: str):
    """FastAPI dependency factory enforcing that the caller holds one of `roles`.

    Usage:  staff: StaffUser = Depends(require_roles(*CASEWORK_ROLES))

    Returns 403 (authenticated but not permitted), never 401 — the distinction
    matters to the dashboard, which should show "not your decision to make"
    rather than bouncing a valid session to the login screen.
    """
    allowed = frozenset(roles)

    def _dependency(staff: StaffUser = Depends(current_staff)) -> StaffUser:
        if staff.role not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    f"Role {staff.role} is not permitted to perform this action. "
                    f"Requires one of: {', '.join(sorted(allowed))}."
                ),
            )
        return staff

    return _dependency


__all__ = [
    "hash_password",
    "verify_password",
    "create_access_token",
    "current_staff",
    "require_roles",
    "ALL_ROLES",
    "CASEWORK_ROLES",
    "ACKNOWLEDGE_ROLES",
    "ESCALATION_ROLES",
    "ADMIN_ROLES",
]
