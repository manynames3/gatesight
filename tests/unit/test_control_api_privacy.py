from datetime import UTC, datetime
from typing import Any

from fastapi import HTTPException
from gatesight_control_api.api_models import RegistrationCreate
from gatesight_control_api.auth import Role
from gatesight_control_api.main import (
    _idempotent_record_id,
    _redact_plate_values,
    create_registration,
)
from gatesight_domain.models import UserContext


def user(role: Role) -> UserContext:
    return UserContext(
        subject=f"user-{role.lower()}",
        tenant_id="ten_1234567890",
        facility_ids=frozenset({"fac_1234567890"}),
        groups=frozenset({role}),
    )


class MemoryStore:
    def __init__(self) -> None:
        self.records: dict[tuple[str, str, str], dict[str, Any]] = {}
        self.registration_writes = 0

    def get(self, table: str, tenant_id: str, record_id: str) -> dict[str, Any] | None:
        return self.records.get((table, tenant_id, record_id))

    def put(
        self,
        table: str,
        item: dict[str, Any],
        condition: str | None = None,
    ) -> None:
        del condition
        self.records[(table, item["tenantId"], item["recordId"])] = dict(item)
        if table == "registrations":
            self.registration_writes += 1


def test_visit_plate_is_masked_for_lower_privilege_roles() -> None:
    source = {"recordId": "vis_1234567890", "normalizedPlate": "ABC123"}
    viewer_record = _redact_plate_values(
        source,
        user("VIEWER"),
    )
    security_record = _redact_plate_values(
        {"recordId": "vis_1234567890", "normalizedPlate": "ABC123"},
        user("SECURITY"),
    )

    assert viewer_record["maskedPlate"] == "A••••3"
    assert "normalizedPlate" not in viewer_record
    assert security_record["normalizedPlate"] == "ABC123"
    assert source["normalizedPlate"] == "ABC123"


def test_registration_id_is_stable_for_an_idempotency_key() -> None:
    first = _idempotent_record_id(
        "reg",
        "ten_1234567890",
        "create-registration",
        "registration:12345678-1234-1234-1234-123456789012",
    )
    second = _idempotent_record_id(
        "reg",
        "ten_1234567890",
        "create-registration",
        "registration:12345678-1234-1234-1234-123456789012",
    )

    assert first == second
    assert first.startswith("reg_")


def test_registration_creation_replays_without_duplicate_write() -> None:
    store = MemoryStore()
    request = RegistrationCreate(
        normalizedPlate="ABC123",
        displayPlate="ABC 123",
        facilityId="fac_1234567890",
        validFrom=datetime(2026, 7, 28, tzinfo=UTC),
        status="ACTIVE",
    )
    key = "registration:12345678-1234-1234-1234-123456789012"

    first = create_registration(request, user("SECURITY"), store, key)
    second = create_registration(request, user("SECURITY"), store, key)

    assert second == first
    assert store.registration_writes == 1


def test_registration_key_cannot_replay_a_different_request() -> None:
    store = MemoryStore()
    key = "registration:12345678-1234-1234-1234-123456789012"
    first = RegistrationCreate(
        normalizedPlate="ABC123",
        displayPlate="ABC 123",
        facilityId="fac_1234567890",
        validFrom=datetime(2026, 7, 28, tzinfo=UTC),
        status="ACTIVE",
    )
    changed = RegistrationCreate(
        normalizedPlate="XYZ789",
        displayPlate="XYZ 789",
        facilityId="fac_1234567890",
        validFrom=datetime(2026, 7, 28, tzinfo=UTC),
        status="ACTIVE",
    )
    create_registration(first, user("SECURITY"), store, key)

    try:
        create_registration(changed, user("SECURITY"), store, key)
    except HTTPException as error:
        assert error.status_code == 409
    else:
        raise AssertionError("an idempotency key must not replay an edited registration")
