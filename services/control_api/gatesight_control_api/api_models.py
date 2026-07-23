"""HTTP request and response contracts."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any, Literal

from gatesight_domain.models import Direction, RegistrationStatus, ReviewDecision
from pydantic import BaseModel, ConfigDict, Field, StringConstraints

IdempotencyKey = Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9._:-]{16,128}$")]


class ApiModel(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class FacilityCreate(ApiModel):
    name: str = Field(min_length=2, max_length=120)
    timezone: str = Field(min_length=1, max_length=64)


class StationCreate(ApiModel):
    name: str = Field(min_length=2, max_length=120)
    direction: Direction
    motion_sensitivity: float = Field(default=0.12, ge=0.01, le=0.8)
    cooldown_seconds: int = Field(default=15, ge=3, le=600)


class HeartbeatRequest(ApiModel):
    armed: bool
    client_time: datetime
    camera_device_hash: str | None = Field(default=None, max_length=128)


class CaptureCreate(ApiModel):
    facility_id: str = Field(min_length=10, max_length=64, alias="facilityId")
    station_id: str = Field(min_length=10, max_length=64, alias="stationId")
    frame_count: int = Field(ge=3, le=5, alias="frameCount")
    captured_at_client: datetime = Field(alias="capturedAtClient")
    client_clock_offset_ms: int = Field(ge=-86_400_000, le=86_400_000, alias="clientClockOffsetMs")


class PresignedFrame(ApiModel):
    frame_index: int = Field(alias="frameIndex")
    key: str
    url: str
    fields: dict[str, str]
    expires_in: int = Field(alias="expiresIn")


class CaptureCreated(ApiModel):
    capture_id: str = Field(alias="captureId")
    status: Literal["UPLOADING"]
    uploads: list[PresignedFrame]
    received_at_server: datetime = Field(alias="receivedAtServer")
    estimated_captured_at_server: datetime = Field(alias="estimatedCapturedAtServer")
    correlation_id: str = Field(alias="correlationId")


class CaptureComplete(ApiModel):
    uploaded_keys: list[str] = Field(min_length=3, max_length=5, alias="uploadedKeys")


class ObservationReview(ApiModel):
    decision: ReviewDecision
    corrected_plate: str | None = Field(
        default=None, min_length=1, max_length=24, alias="correctedPlate"
    )
    note: str = Field(min_length=3, max_length=1000)


class RegistrationCreate(ApiModel):
    normalized_plate: str = Field(min_length=1, max_length=12, alias="normalizedPlate")
    display_plate: str = Field(min_length=1, max_length=24, alias="displayPlate")
    facility_id: str | None = Field(default=None, alias="facilityId")
    plate_region: str | None = Field(default=None, max_length=24, alias="plateRegion")
    description: str | None = Field(default=None, max_length=240)
    valid_from: datetime = Field(alias="validFrom")
    valid_until: datetime | None = Field(default=None, alias="validUntil")
    status: RegistrationStatus = RegistrationStatus.ACTIVE


class RegistrationPatch(ApiModel):
    display_plate: str | None = Field(
        default=None, min_length=1, max_length=24, alias="displayPlate"
    )
    plate_region: str | None = Field(default=None, max_length=24, alias="plateRegion")
    description: str | None = Field(default=None, max_length=240)
    valid_until: datetime | None = Field(default=None, alias="validUntil")
    status: RegistrationStatus | None = None


class Page(ApiModel):
    items: list[dict[str, Any]]
    next_cursor: str | None = Field(default=None, alias="nextCursor")
