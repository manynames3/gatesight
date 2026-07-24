from __future__ import annotations

import importlib
import sys
from unittest.mock import patch


def test_powertools_stream_image_is_not_deserialized_twice() -> None:
    sys.modules.pop("gatesight_outbox_publisher.handler", None)
    with patch("boto3.session.Session"):
        handler = importlib.import_module("gatesight_outbox_publisher.handler")

    image = {
        "tenantId": "tenant_portfolio",
        "status": "PENDING",
        "event": {"type": "com.gatesight.plate-recognition.completed.v1"},
    }

    assert handler._stream_item(image) == image
