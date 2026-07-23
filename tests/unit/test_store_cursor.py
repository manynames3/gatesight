import pytest
from gatesight_control_api.store import decode_cursor, encode_cursor


def test_cursor_round_trip() -> None:
    key = {"tenantId": "ten_1234567890", "recordId": "obs_1234567890"}
    assert decode_cursor(encode_cursor(key)) == key


def test_invalid_cursor_is_rejected() -> None:
    with pytest.raises(ValueError):
        decode_cursor("not-json")
