"""Validated domain models shared by Lambda functions."""

from __future__ import annotations

from datetime import UTC, datetime
from enum import StrEnum
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

PlateText = Annotated[str, StringConstraints(pattern=r"^[A-Z0-9]{1,12}$")]
Identifier = Annotated[str, StringConstraints(min_length=10, max_length=64)]


def utc_now() -> datetime:
    return datetime.now(UTC)


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class Direction(StrEnum):
    ENTRY = "ENTRY"
    EXIT = "EXIT"


class CaptureStatus(StrEnum):
    CREATED = "CREATED"
    UPLOADING = "UPLOADING"
    QUEUED = "QUEUED"
    PROCESSING = "PROCESSING"
    RECOGNIZED = "RECOGNIZED"
    NEEDS_REVIEW = "NEEDS_REVIEW"
    NO_PLATE = "NO_PLATE"
    MULTIPLE_PLATES = "MULTIPLE_PLATES"
    FAILED = "FAILED"


class ObservationState(StrEnum):
    RECOGNIZED = "RECOGNIZED"
    NEEDS_REVIEW = "NEEDS_REVIEW"
    NO_PLATE = "NO_PLATE"
    MULTIPLE_PLATES = "MULTIPLE_PLATES"
    FAILED = "FAILED"


class ReviewDecision(StrEnum):
    CONFIRMED = "CONFIRMED"
    CORRECTED = "CORRECTED"
    REJECTED = "REJECTED"


class RegistrationStatus(StrEnum):
    ACTIVE = "ACTIVE"
    EXPIRED = "EXPIRED"
    BLOCKED = "BLOCKED"


class AlertStatus(StrEnum):
    OPEN = "OPEN"
    ACKNOWLEDGED = "ACKNOWLEDGED"
    RESOLVED = "RESOLVED"


class FrameQuality(StrictModel):
    blur_score: float = Field(ge=0)
    exposure_score: float = Field(ge=0, le=1)
    glare_score: float = Field(ge=0, le=1)
    perspective_score: float = Field(ge=0, le=1)
    plate_pixel_width: int = Field(ge=0)
    usable: bool
    reasons: list[str] = Field(default_factory=list, max_length=12)


class PlateCandidate(StrictModel):
    frame_index: int = Field(ge=0, le=9)
    raw_text: str = Field(max_length=32)
    normalized_text: PlateText | None
    detector_confidence: float = Field(ge=0, le=1)
    ocr_confidence: float = Field(ge=0, le=1)
    character_confidences: list[float] = Field(default_factory=list, max_length=16)
    region: str | None = Field(default=None, max_length=24)
    region_confidence: float | None = Field(default=None, ge=0, le=1)
    quality: FrameQuality
    bounding_box: tuple[int, int, int, int]


class ConsensusResult(StrictModel):
    state: ObservationState
    normalized_text: PlateText | None = None
    consensus_score: float = Field(ge=0, le=1)
    reason: str
    candidates: list[PlateCandidate]
    ambiguous_plate_count: int = Field(default=0, ge=0)

    @field_validator("normalized_text")
    @classmethod
    def recognized_requires_text(cls, value: str | None, info: Any) -> str | None:
        if info.data.get("state") == ObservationState.RECOGNIZED and not value:
            raise ValueError("RECOGNIZED requires normalized_text")
        return value


class RecognitionJob(StrictModel):
    schema_version: Literal["1.0"] = "1.0"
    capture_id: Identifier
    tenant_id: Identifier
    facility_id: Identifier
    station_id: Identifier
    direction: Direction
    correlation_id: Identifier
    s3_bucket: str = Field(min_length=3, max_length=63)
    s3_keys: list[str] = Field(min_length=3, max_length=5)
    captured_at_client: datetime
    estimated_captured_at_server: datetime
    received_at_server: datetime
    facility_timezone: str = Field(min_length=1, max_length=64)


class CompletedEventData(StrictModel):
    observation_id: Identifier
    capture_id: Identifier
    facility_id: Identifier
    station_id: Identifier
    direction: Direction
    state: ObservationState
    captured_at: datetime
    confidence_category: Literal["HIGH", "MEDIUM", "LOW", "NONE"]
    lookup_token: str | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")


class DomainEvent(StrictModel):
    specversion: Literal["1.0"] = "1.0"
    id: Identifier
    type: Literal["com.gatesight.plate-recognition.completed.v1"]
    source: Literal["/services/recognition-worker"] = "/services/recognition-worker"
    subject: str
    time: datetime
    datacontenttype: Literal["application/json"] = "application/json"
    correlation_id: Identifier = Field(alias="correlationId")
    tenant_id: Identifier = Field(alias="tenantId")
    data: CompletedEventData


class Registration(StrictModel):
    registration_id: Identifier
    tenant_id: Identifier
    facility_id: Identifier | None = None
    normalized_plate: PlateText
    display_plate: str = Field(min_length=1, max_length=24)
    plate_region: str | None = Field(default=None, max_length=24)
    description: str | None = Field(default=None, max_length=240)
    valid_from: datetime
    valid_until: datetime | None = None
    status: RegistrationStatus
    created_at: datetime = Field(default_factory=utc_now)


class VisitOutcome(StrictModel):
    action: Literal["OPENED", "CLOSED", "DUPLICATE_SUPPRESSED", "ANOMALY"]
    anomaly: Literal["REPEATED_ENTRY", "ORPHAN_EXIT"] | None = None
    dwell_seconds: int | None = Field(default=None, ge=0)


class UserContext(StrictModel):
    subject: str
    tenant_id: Identifier
    facility_ids: frozenset[str] = frozenset()
    groups: frozenset[Literal["ADMIN", "SECURITY", "OPERATOR", "VIEWER"]]
