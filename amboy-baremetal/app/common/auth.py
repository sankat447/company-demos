"""Keycloak-gated authorization for re-identification.

Re-ID is the highest-privilege action, so it requires the `npi-reveal` role.
Two modes:
  * prod  — verify the Keycloak-issued JWT signature against the realm JWKS and
            read realm_access.roles.
  * demo  (AUTH_DEV_MODE=1) — trust the X-Amboy-Roles header (UNVERIFIED). This
            is an explicit demo gap (Keycloak realm/clients not always wired).
Returns (actor, roles). Raises 403 if the required role is absent.
"""
from __future__ import annotations

from fastapi import Header, HTTPException

from . import config


def _roles_from_jwt(token: str):
    from jose import jwt  # lazy
    import httpx
    jwks = httpx.get(
        f"{config.KEYCLOAK_URL}/realms/{config.KEYCLOAK_REALM}/protocol/openid-connect/certs",
        timeout=5.0).json()
    claims = jwt.decode(token, jwks, options={"verify_aud": False})
    actor = claims.get("preferred_username") or claims.get("sub") or "unknown"
    roles = (claims.get("realm_access", {}) or {}).get("roles", [])
    return actor, roles


def require_npi_reveal(authorization: str | None = Header(default=None),
                       x_amboy_roles: str | None = Header(default=None)):
    if config.AUTH_DEV_MODE:
        roles = [r.strip() for r in (x_amboy_roles or "").split(",") if r.strip()]
        actor = "demo-user"
    else:
        if not authorization or not authorization.lower().startswith("bearer "):
            raise HTTPException(401, "missing bearer token")
        try:
            actor, roles = _roles_from_jwt(authorization.split(" ", 1)[1])
        except Exception as e:
            raise HTTPException(401, f"invalid token: {e}")
    if config.NPI_REVEAL_ROLE not in roles:
        raise HTTPException(403, f"role '{config.NPI_REVEAL_ROLE}' required to reveal NPI")
    return actor, roles
