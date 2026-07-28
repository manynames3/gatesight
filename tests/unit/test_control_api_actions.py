from __future__ import annotations

from collections import Counter
from typing import Any

from botocore.exceptions import ClientError
from fastapi import HTTPException
from gatesight_control_api.main import (
    _idempotency_token,
    acknowledge_alert,
    app,
    delete_observation_media,
    resolve_alert,
)
from gatesight_domain.models import UserContext


def conditional_failure() -> ClientError:
    return ClientError(
        {
            "Error": {
                "Code": "ConditionalCheckFailedException",
                "Message": "condition failed",
            }
        },
        "UpdateItem",
    )


def security_user() -> UserContext:
    return UserContext(
        subject="user-security",
        tenant_id="ten_1234567890",
        facility_ids=frozenset({"fac_1234567890"}),
        groups=frozenset({"SECURITY"}),
    )


class ActionStore:
    def __init__(self) -> None:
        self.records: dict[tuple[str, str, str], dict[str, Any]] = {}
        self.writes: Counter[str] = Counter()
        self.updates: Counter[str] = Counter()
        self.deleted_media: list[list[str]] = []

    def add(self, table: str, item: dict[str, Any]) -> None:
        self.records[(table, item["tenantId"], item["recordId"])] = dict(item)

    def get(self, table: str, tenant_id: str, record_id: str) -> dict[str, Any] | None:
        item = self.records.get((table, tenant_id, record_id))
        return dict(item) if item else None

    def put(
        self,
        table: str,
        item: dict[str, Any],
        condition: str | None = None,
    ) -> None:
        key = (table, item["tenantId"], item["recordId"])
        if condition and key in self.records:
            raise conditional_failure()
        self.records[key] = dict(item)
        self.writes[table] += 1

    def update(
        self,
        table: str,
        tenant_id: str,
        record_id: str,
        expression: str,
        values: dict[str, Any],
        *,
        names: dict[str, str] | None = None,
        condition: str | None = None,
        return_values: str = "ALL_NEW",
    ) -> dict[str, Any]:
        del expression, names, return_values
        key = (table, tenant_id, record_id)
        current = dict(self.records[key])
        if table == "alerts":
            allowed = {"OPEN"}
            if ":acknowledged" in values:
                allowed.add("ACKNOWLEDGED")
            if condition and current["status"] not in allowed:
                raise conditional_failure()
            target = values[":target"]
            action = "acknowledge" if target == "ACKNOWLEDGED" else "resolve"
            current.update(
                {
                    "status": target,
                    "statusActor": values[":actor"],
                    "statusChangedAt": values[":at"],
                    ("acknowledgedAt" if target == "ACKNOWLEDGED" else "resolvedAt"): values[":at"],
                    ("acknowledgedBy" if target == "ACKNOWLEDGED" else "resolvedBy"): values[
                        ":actor"
                    ],
                    f"{action}RequestToken": values[":token"],
                }
            )
        elif table == "observations":
            if condition and (
                current.get("mediaDeletedAt") or current.get("mediaAvailable", True) is False
            ):
                raise conditional_failure()
            current.update(
                {
                    "mediaDeletedAt": values[":at"],
                    "mediaDeletedBy": values[":actor"],
                    "mediaAvailable": values[":false"],
                }
            )
        else:
            raise AssertionError(f"unexpected update table {table}")
        self.records[key] = current
        self.updates[table] += 1
        return dict(current)

    def delete_media(self, keys: list[str]) -> None:
        self.deleted_media.append(list(keys))


def alert_record() -> dict[str, Any]:
    return {
        "tenantId": "ten_1234567890",
        "recordId": "alt_1234567890",
        "facilityId": "fac_1234567890",
        "status": "OPEN",
    }


def observation_record() -> dict[str, Any]:
    return {
        "tenantId": "ten_1234567890",
        "recordId": "obs_1234567890",
        "facilityId": "fac_1234567890",
        "captureId": "cap_1234567890",
        "derivedCropKeys": ["derived/plate.jpg"],
        "mediaAvailable": True,
    }


def capture_record() -> dict[str, Any]:
    return {
        "tenantId": "ten_1234567890",
        "recordId": "cap_1234567890",
        "frameKeys": ["capture/frame-0.jpg", "capture/frame-1.jpg"],
    }


def test_action_routes_require_idempotency_headers() -> None:
    schema = app.openapi()
    paths = (
        "/v1/alerts/{alert_id}/acknowledge",
        "/v1/alerts/{alert_id}/resolve",
        "/v1/observations/{observation_id}/delete-media",
    )

    for path in paths:
        parameters = schema["paths"][path]["post"]["parameters"]
        header = next(item for item in parameters if item["name"] == "Idempotency-Key")
        assert header["in"] == "header"
        assert header["required"] is True


def test_alert_transition_replays_without_duplicate_state_or_audit() -> None:
    store = ActionStore()
    store.add("alerts", alert_record())
    key = "alert:12345678-1234-1234-1234-123456789012"

    first = acknowledge_alert("alt_1234567890", security_user(), store, key)
    second = acknowledge_alert("alt_1234567890", security_user(), store, key)

    assert second == first
    assert first["status"] == "ACKNOWLEDGED"
    assert store.updates["alerts"] == 1
    assert store.writes["audit"] == 1


def test_alert_transition_recovers_after_state_write_before_replay_record() -> None:
    store = ActionStore()
    key = "alert:12345678-1234-1234-1234-123456789012"
    operation = "acknowledge-alert:alt_1234567890"
    alert = alert_record()
    alert.update(
        {
            "status": "ACKNOWLEDGED",
            "acknowledgedAt": "2026-07-28T12:00:00+00:00",
            "acknowledgedBy": "user-security",
            "acknowledgeRequestToken": _idempotency_token(
                "ten_1234567890",
                operation,
                key,
            ),
        }
    )
    store.add("alerts", alert)

    result = acknowledge_alert("alt_1234567890", security_user(), store, key)

    assert result == {
        "alertId": "alt_1234567890",
        "status": "ACKNOWLEDGED",
        "statusActor": "user-security",
        "statusChangedAt": "2026-07-28T12:00:00+00:00",
    }
    assert store.updates["alerts"] == 0
    assert store.writes["audit"] == 1
    assert store.writes["idempotency"] == 1


def test_resolved_alert_rejects_a_new_acknowledgement_intent() -> None:
    store = ActionStore()
    store.add("alerts", alert_record())
    resolve_alert(
        "alt_1234567890",
        security_user(),
        store,
        "resolve:12345678-1234-1234-1234-123456789012",
    )

    try:
        acknowledge_alert(
            "alt_1234567890",
            security_user(),
            store,
            "acknowledge:12345678-1234-1234-1234-123456789012",
        )
    except HTTPException as error:
        assert error.status_code == 409
    else:
        raise AssertionError("a resolved alert must not return to acknowledged")


def test_media_deletion_replays_without_duplicate_delete_or_audit() -> None:
    store = ActionStore()
    store.add("observations", observation_record())
    store.add("captures", capture_record())
    key = "media:12345678-1234-1234-1234-123456789012"

    first = delete_observation_media(
        "obs_1234567890",
        security_user(),
        store,
        key,
    )
    second = delete_observation_media(
        "obs_1234567890",
        security_user(),
        store,
        key,
    )

    assert second == first
    assert store.deleted_media == [
        ["capture/frame-0.jpg", "capture/frame-1.jpg", "derived/plate.jpg"]
    ]
    assert store.updates["observations"] == 1
    assert store.writes["audit"] == 1


def test_media_deletion_recovers_after_state_write_before_replay_record() -> None:
    store = ActionStore()
    observation = observation_record()
    observation.update(
        {
            "mediaAvailable": False,
            "mediaDeletedAt": "2026-07-28T12:00:00+00:00",
            "mediaDeletedBy": "user-security",
        }
    )
    store.add("observations", observation)

    result = delete_observation_media(
        "obs_1234567890",
        security_user(),
        store,
        "media:12345678-1234-1234-1234-123456789012",
    )

    assert result["mediaDeletedAt"] == "2026-07-28T12:00:00+00:00"
    assert store.deleted_media == []
    assert store.updates["observations"] == 0
    assert store.writes["audit"] == 1
    assert store.writes["idempotency"] == 1


def test_media_deletion_is_resource_idempotent_across_request_keys() -> None:
    store = ActionStore()
    store.add("observations", observation_record())
    store.add("captures", capture_record())

    first = delete_observation_media(
        "obs_1234567890",
        security_user(),
        store,
        "media:first:123456789",
    )
    second = delete_observation_media(
        "obs_1234567890",
        security_user(),
        store,
        "media:second:12345678",
    )

    assert second == first
    assert len(store.deleted_media) == 1
    assert store.writes["audit"] == 1
