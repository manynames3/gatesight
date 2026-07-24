from unittest.mock import Mock

import pytest
from gatesight_control_api.store import AwsStore, decode_cursor, encode_cursor


def test_cursor_round_trip() -> None:
    key = {"tenantId": "ten_1234567890", "recordId": "obs_1234567890"}
    assert decode_cursor(encode_cursor(key)) == key


def test_invalid_cursor_is_rejected() -> None:
    with pytest.raises(ValueError):
        decode_cursor("not-json")


def test_first_query_omits_empty_exclusive_start_key(monkeypatch: pytest.MonkeyPatch) -> None:
    table = Mock()
    table.query.return_value = {"Items": []}
    store = object.__new__(AwsStore)
    monkeypatch.setattr(store, "table", lambda _: table)

    assert store.query(
        "facilities",
        "byTenantCreated",
        "tenantId",
        "tenant_portfolio",
        limit=50,
        cursor=None,
    ) == ([], None)

    assert "ExclusiveStartKey" not in table.query.call_args.kwargs
