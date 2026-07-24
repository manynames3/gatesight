from __future__ import annotations

from decimal import Decimal

import pytest
from gatesight_recognition_worker.repository import serialize


def test_serialize_converts_nested_floats_to_dynamodb_numbers() -> None:
    result = serialize(
        {
            "candidates": [
                {
                    "detectorConfidence": 0.95,
                    "characterConfidences": [0.98, 0.99],
                }
            ]
        }
    )

    assert result == {
        "candidates": {
            "L": [
                {
                    "M": {
                        "detectorConfidence": {"N": str(Decimal("0.95"))},
                        "characterConfidences": {
                            "L": [
                                {"N": str(Decimal("0.98"))},
                                {"N": str(Decimal("0.99"))},
                            ]
                        },
                    }
                }
            ]
        }
    }


def test_serialize_rejects_nonfinite_numbers() -> None:
    with pytest.raises(ValueError, match="must be finite"):
        serialize({"confidence": float("nan")})


def test_serialize_omits_null_sparse_index_keys() -> None:
    assert serialize({"tenantId": "tenant_portfolio", "normalizedPlate": None}) == {
        "tenantId": {"S": "tenant_portfolio"}
    }
