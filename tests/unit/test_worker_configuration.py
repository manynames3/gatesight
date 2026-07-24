from unittest.mock import patch

from gatesight_recognition_worker import handler


def test_secure_configuration_is_decrypted_before_use() -> None:
    with (
        patch.object(handler, "CONFIG_PREFIX", "/gatesight-dev/recognition"),
        patch.object(handler, "get_parameter", return_value="0.88") as get_parameter,
    ):
        value = handler._configuration("high-confidence", "0.75")

    assert value == "0.88"
    get_parameter.assert_called_once_with(
        "/gatesight-dev/recognition/high-confidence",
        max_age=300,
        decrypt=True,
    )
