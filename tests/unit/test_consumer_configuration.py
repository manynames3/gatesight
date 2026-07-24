from __future__ import annotations

import importlib
import sys
from collections.abc import Iterator
from unittest.mock import MagicMock, call, patch

import pytest


@pytest.fixture
def secure_configuration(monkeypatch: pytest.MonkeyPatch) -> Iterator[MagicMock]:
    monkeypatch.setenv("GATESIGHT_CONFIG_PREFIX", "/gatesight-dev/recognition")
    with (
        patch("aws_lambda_powertools.utilities.parameters.get_parameter") as get_parameter,
        patch("boto3.session.Session"),
    ):
        yield get_parameter


def test_visit_projector_decrypts_secure_configuration(
    secure_configuration: MagicMock,
) -> None:
    secure_configuration.return_value = "30"
    sys.modules.pop("gatesight_visit_projector.handler", None)

    importlib.import_module("gatesight_visit_projector.handler")

    secure_configuration.assert_called_once_with(
        "/gatesight-dev/recognition/duplicate-window",
        max_age=300,
        decrypt=True,
    )


def test_security_evaluator_decrypts_secure_configuration(
    secure_configuration: MagicMock,
) -> None:
    secure_configuration.side_effect = ["900", "0.88"]
    sys.modules.pop("gatesight_security_evaluator.handler", None)

    importlib.import_module("gatesight_security_evaluator.handler")

    assert secure_configuration.call_args_list == [
        call(
            "/gatesight-dev/recognition/alert-suppression",
            max_age=300,
            decrypt=True,
        ),
        call(
            "/gatesight-dev/recognition/high-confidence",
            max_age=300,
            decrypt=True,
        ),
    ]
