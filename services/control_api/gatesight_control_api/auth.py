"""Cognito-claim extraction and object-level authorization."""

from __future__ import annotations

import json
from collections.abc import Callable
from typing import Annotated, Any, Literal, cast

from fastapi import Depends, Header, HTTPException, Request, status
from gatesight_domain.models import UserContext

from gatesight_control_api.settings import settings

Role = Literal["ADMIN", "SECURITY", "OPERATOR", "VIEWER"]


def _claims_from_api_gateway(request: Request) -> dict[str, Any]:
    event = request.scope.get("aws.event", {})
    claims = event.get("requestContext", {}).get("authorizer", {}).get("jwt", {}).get("claims", {})
    return dict(claims) if isinstance(claims, dict) else {}


def _groups(claims: dict[str, Any]) -> frozenset[str]:
    raw = claims.get("cognito:groups", [])
    if isinstance(raw, str):
        try:
            decoded = json.loads(raw)
            raw = decoded if isinstance(decoded, list) else raw.split(",")
        except json.JSONDecodeError:
            raw = raw.split(",")
    return frozenset(str(group).strip() for group in raw if str(group).strip())


def get_user(
    request: Request,
    x_gatesight_dev_claims: Annotated[str | None, Header()] = None,
) -> UserContext:
    claims = _claims_from_api_gateway(request)
    if not claims and settings.environment == "local" and x_gatesight_dev_claims:
        try:
            value = json.loads(x_gatesight_dev_claims)
            claims = value if isinstance(value, dict) else {}
        except json.JSONDecodeError as error:
            raise HTTPException(
                status_code=401, detail="invalid local development claims"
            ) from error
    tenant_id = claims.get("custom:tenant_id")
    subject = claims.get("sub")
    if not tenant_id or not subject:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="missing verified identity",
        )
    facilities = frozenset(
        part.strip()
        for part in str(claims.get("custom:facility_ids", "")).split(",")
        if part.strip()
    )
    groups = _groups(claims)
    allowed_groups: frozenset[Role] = frozenset({"ADMIN", "SECURITY", "OPERATOR", "VIEWER"})
    if not groups.intersection(allowed_groups):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="no GateSight role")
    return UserContext(
        subject=subject,
        tenant_id=tenant_id,
        facility_ids=facilities,
        groups=cast(frozenset[Role], groups.intersection(allowed_groups)),
    )


CurrentUser = Annotated[UserContext, Depends(get_user)]


def require_roles(*roles: str) -> Callable[[CurrentUser], UserContext]:
    def dependency(user: CurrentUser) -> UserContext:
        if "ADMIN" not in user.groups and not user.groups.intersection(roles):
            raise HTTPException(status_code=403, detail="role is not authorized")
        return user

    return dependency


def authorize_facility(user: UserContext, facility_id: str) -> None:
    if "ADMIN" not in user.groups and facility_id not in user.facility_ids:
        raise HTTPException(status_code=403, detail="facility is not authorized")
