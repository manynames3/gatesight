from gatesight_control_api.auth import _groups


def test_cognito_groups_accept_json_or_csv_claims() -> None:
    assert _groups({"cognito:groups": '["ADMIN","VIEWER"]'}) == {"ADMIN", "VIEWER"}
    assert _groups({"cognito:groups": "SECURITY,OPERATOR"}) == {"SECURITY", "OPERATOR"}


def test_no_group_claim_is_empty() -> None:
    assert not _groups({})
