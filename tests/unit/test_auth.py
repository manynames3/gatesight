from gatesight_control_api.auth import _groups


def test_cognito_groups_accept_supported_claim_formats() -> None:
    assert _groups({"cognito:groups": '["ADMIN","VIEWER"]'}) == {"ADMIN", "VIEWER"}
    assert _groups({"cognito:groups": "SECURITY,OPERATOR"}) == {"SECURITY", "OPERATOR"}
    assert _groups({"cognito:groups": "[ADMIN, OPERATOR]"}) == {"ADMIN", "OPERATOR"}
    assert _groups({"cognito:groups": "[ADMIN OPERATOR]"}) == {"ADMIN", "OPERATOR"}
    assert _groups({"cognito:groups": "['ADMIN', 'VIEWER']"}) == {"ADMIN", "VIEWER"}


def test_no_group_claim_is_empty() -> None:
    assert not _groups({})
