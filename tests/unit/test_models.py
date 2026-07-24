from datetime import UTC, datetime

import pytest
from gatesight_domain.models import NormalizedRegion, RecognitionJob
from pydantic import ValidationError


def recognition_job(**overrides: object) -> RecognitionJob:
    values: dict[str, object] = {
        "capture_id": "cap_01J123456789ABCDEFGHJKMNPQ",
        "tenant_id": "tenant_portfolio",
        "facility_id": "fac_san_diego",
        "station_id": "sta_san_diego_exit",
        "direction": "EXIT",
        "correlation_id": "cor_01J123456789ABCDEFGHJKMNPQ",
        "s3_bucket": "gatesight-example",
        "s3_keys": ["frame-0.jpg", "frame-1.jpg", "frame-2.jpg", "frame-3.jpg"],
        "captured_at_client": datetime.now(UTC),
        "estimated_captured_at_server": datetime.now(UTC),
        "received_at_server": datetime.now(UTC),
        "facility_timezone": "America/Los_Angeles",
    }
    values.update(overrides)
    return RecognitionJob.model_validate(values)


def test_recognition_job_accepts_guide_and_synthetic_marker() -> None:
    job = recognition_job(
        guide_region={"x": 0.25, "y": 0.35, "width": 0.5, "height": 0.3},
        synthetic=True,
    )

    assert job.guide_region == NormalizedRegion(x=0.25, y=0.35, width=0.5, height=0.3)
    assert job.synthetic


def test_guide_region_must_fit_inside_the_frame() -> None:
    with pytest.raises(ValidationError, match="fit inside"):
        recognition_job(
            guide_region={"x": 0.8, "y": 0.2, "width": 0.4, "height": 0.3},
        )
