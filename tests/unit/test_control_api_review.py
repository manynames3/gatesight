from __future__ import annotations

from types import SimpleNamespace
from typing import Any

from fastapi import HTTPException
from gatesight_control_api.api_models import ObservationReview
from gatesight_control_api.main import review_observation
from gatesight_domain.models import UserContext


def security_user() -> UserContext:
    return UserContext(
        subject="user-security",
        tenant_id="ten_1234567890",
        facility_ids=frozenset({"fac_1234567890"}),
        groups=frozenset({"SECURITY"}),
    )


def request() -> Any:
    return SimpleNamespace(
        state=SimpleNamespace(correlation_id="cor_1234567890"),
    )


class ReviewStore:
    def __init__(self, state: str) -> None:
        self.records: dict[tuple[str, str, str], dict[str, Any]] = {}
        self.transactions = 0
        self.add(
            "observations",
            {
                "tenantId": "ten_1234567890",
                "recordId": "obs_1234567890",
                "captureId": "cap_1234567890",
                "facilityId": "fac_1234567890",
                "stationId": "sta_1234567890",
                "direction": "ENTRY",
                "state": state,
                "normalizedPlate": "OLD123" if state == "RECOGNIZED" else None,
                "capturedAt": "2026-07-28T14:05:00+00:00",
                "synthetic": False,
                "reviewDecision": "PENDING",
            },
        )
        self.add(
            "captures",
            {
                "tenantId": "ten_1234567890",
                "recordId": "cap_1234567890",
                "status": state,
            },
        )

    def add(self, table: str, item: dict[str, Any]) -> None:
        self.records[(table, item["tenantId"], item["recordId"])] = dict(item)

    def get(self, table: str, tenant_id: str, record_id: str) -> dict[str, Any] | None:
        item = self.records.get((table, tenant_id, record_id))
        return dict(item) if item else None

    def save_observation_review(
        self,
        *,
        tenant_id: str,
        observation_id: str,
        capture_id: str,
        update_expression: str,
        update_values: dict[str, Any],
        update_names: dict[str, str],
        update_condition: str,
        audit: dict[str, Any],
        idempotency: dict[str, Any],
        outbox: dict[str, Any] | None,
        client_request_token: str,
    ) -> None:
        del update_expression, update_names, update_condition, client_request_token
        self.transactions += 1
        observation_key = ("observations", tenant_id, observation_id)
        observation = dict(self.records[observation_key])
        observation.update(
            {
                "reviewDecision": update_values[":decision"],
                "reviewNote": update_values[":note"],
                "reviewedBy": update_values[":user"],
                "reviewedAt": update_values[":at"],
            }
        )
        if ":plate" in update_values:
            observation.update(
                {
                    "normalizedPlate": update_values[":plate"],
                    "state": "RECOGNIZED",
                    "consensusScore": update_values[":score"],
                    "decisionReason": update_values[":reason"],
                }
            )
            capture_key = ("captures", tenant_id, capture_id)
            capture = dict(self.records[capture_key])
            capture["status"] = "RECOGNIZED"
            self.records[capture_key] = capture
        elif ":reason" in update_values:
            observation["decisionReason"] = update_values[":reason"]
        self.records[observation_key] = observation
        self.add("audit", audit)
        self.add("idempotency", idempotency)
        if outbox is not None:
            self.add("outbox", outbox)


def test_corrected_review_atomically_emits_a_replay_safe_projection_event() -> None:
    store = ReviewStore("NEEDS_REVIEW")
    body = ObservationReview(
        decision="CORRECTED",
        correctedPlate="ABC 123",
        note="Verified against the protected frame",
    )
    key = "review:12345678-1234-1234-1234-123456789012"

    first = review_observation(
        "obs_1234567890",
        body,
        request(),
        security_user(),
        store,
        key,
    )
    second = review_observation(
        "obs_1234567890",
        body,
        request(),
        security_user(),
        store,
        key,
    )

    assert first == {
        "observationId": "obs_1234567890",
        "reviewDecision": "CORRECTED",
        "state": "RECOGNIZED",
    }
    assert second == first
    assert store.transactions == 1
    observation = store.get("observations", "ten_1234567890", "obs_1234567890")
    assert observation is not None
    assert observation["normalizedPlate"] == "ABC123"
    assert observation["state"] == "RECOGNIZED"
    outbox_records = [item for (table, _, _), item in store.records.items() if table == "outbox"]
    assert len(outbox_records) == 1
    event = outbox_records[0]["event"]
    assert event["source"] == "/services/control-api"
    assert event["data"]["state"] == "RECOGNIZED"


def test_recognized_observation_can_only_be_confirmed() -> None:
    store = ReviewStore("RECOGNIZED")

    try:
        review_observation(
            "obs_1234567890",
            ObservationReview(
                decision="CORRECTED",
                correctedPlate="NEW123",
                note="Attempted replacement",
            ),
            request(),
            security_user(),
            store,
            "review:12345678-1234-1234-1234-123456789012",
        )
    except HTTPException as error:
        assert error.status_code == 409
    else:
        raise AssertionError("a projected recognition cannot be silently rewritten")


def test_rejected_uncertain_observation_does_not_emit_projection_event() -> None:
    store = ReviewStore("NEEDS_REVIEW")

    result = review_observation(
        "obs_1234567890",
        ObservationReview(
            decision="REJECTED",
            note="The guide contained no usable vehicle plate",
        ),
        request(),
        security_user(),
        store,
        "review:12345678-1234-1234-1234-123456789012",
    )

    assert result["reviewDecision"] == "REJECTED"
    assert result["state"] == "NEEDS_REVIEW"
    assert not any(table == "outbox" for table, _, _ in store.records)
