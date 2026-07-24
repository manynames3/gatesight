from unittest.mock import patch

from gatesight_control_api.store import AwsStore


def test_s3_client_uses_regional_virtual_hosted_urls() -> None:
    with patch("gatesight_control_api.store.boto3.session.Session") as session:
        AwsStore()

    s3_call = next(
        call for call in session.return_value.client.call_args_list if call.args == ("s3",)
    )
    assert s3_call.kwargs["config"].signature_version == "s3v4"
    assert s3_call.kwargs["config"].s3 == {
        "addressing_style": "virtual",
        "us_east_1_regional_endpoint": "regional",
    }
