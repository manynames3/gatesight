from unittest.mock import Mock, patch

from botocore.exceptions import ClientError
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


def test_frame_verification_distinguishes_missing_from_aws_failure() -> None:
    store = object.__new__(AwsStore)
    store.head_frame = Mock(return_value={})
    assert store.frame_is_verified("frame.jpg", "cap_1234567890")

    store.head_frame = Mock(
        side_effect=ClientError(
            {"Error": {"Code": "NoSuchKey", "Message": "missing"}},
            "HeadObject",
        )
    )
    assert not store.frame_is_verified("frame.jpg", "cap_1234567890")

    store.head_frame = Mock(
        side_effect=ClientError(
            {"Error": {"Code": "AccessDenied", "Message": "denied"}},
            "HeadObject",
        )
    )
    try:
        store.frame_is_verified("frame.jpg", "cap_1234567890")
    except ClientError:
        pass
    else:
        raise AssertionError("AccessDenied must not be treated as a missing frame")
