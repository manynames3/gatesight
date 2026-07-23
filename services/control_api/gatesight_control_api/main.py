"""FastAPI control plane exposed by API Gateway and Mangum."""

from __future__ import annotations

import hashlib
import os
from datetime import UTC, datetime, timedelta
from functools import lru_cache
from typing import Annotated, Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import ulid
from aws_lambda_powertools import Logger, Metrics, Tracer
from aws_lambda_powertools.metrics import MetricUnit
from botocore.exceptions import ClientError
from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from gatesight_domain.models import CaptureStatus
from gatesight_domain.normalization import normalize_plate
from mangum import Mangum

from gatesight_control_api.api_models import (
    CaptureComplete,
    CaptureCreate,
    CaptureCreated,
    FacilityCreate,
    HeartbeatRequest,
    IdempotencyKey,
    ObservationReview,
    Page,
    PresignedFrame,
    RegistrationCreate,
    RegistrationPatch,
    StationCreate,
)
from gatesight_control_api.auth import (
    CurrentUser,
    authorize_facility,
    require_roles,
)
from gatesight_control_api.settings import settings
from gatesight_control_api.store import AwsStore, is_conditional_failure

logger = Logger(service="control-api")
tracer = Tracer(service="control-api")
metrics = Metrics(namespace="GateSight", service="control-api")

app = FastAPI(
    title="GateSight Control API",
    version="1.0.0",
    docs_url="/docs" if settings.environment != "prod" else None,
    redoc_url=None,
)
allowed_origins = [
    origin for origin in os.getenv("GATESIGHT_ALLOWED_ORIGINS", "").split(",") if origin
]
if allowed_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "Idempotency-Key", "X-Correlation-Id"],
        expose_headers=["X-Correlation-Id"],
    )


@lru_cache
def get_store() -> AwsStore:
    return AwsStore()


Store = Annotated[AwsStore, Depends(get_store)]


def new_id(prefix: str) -> str:
    return f"{prefix}_{ulid.new()}"


def now() -> datetime:
    return datetime.now(UTC)


def correlation_id(request: Request) -> str:
    supplied = request.headers.get("x-correlation-id")
    return supplied if supplied and 10 <= len(supplied) <= 64 else new_id("cor")


@app.middleware("http")
async def request_context(request: Request, call_next: Any) -> Any:
    request.state.correlation_id = correlation_id(request)
    response = await call_next(request)
    response.headers["X-Correlation-Id"] = request.state.correlation_id
    response.headers["Cache-Control"] = "no-store"
    return response


@app.exception_handler(HTTPException)
async def http_error(request: Request, error: HTTPException) -> JSONResponse:
    code = {
        400: "INVALID_REQUEST",
        401: "UNAUTHENTICATED",
        403: "FORBIDDEN",
        404: "NOT_FOUND",
        409: "STATE_CONFLICT",
        413: "PAYLOAD_TOO_LARGE",
    }.get(error.status_code, "REQUEST_FAILED")
    return JSONResponse(
        status_code=error.status_code,
        content={
            "error": {"code": code, "message": str(error.detail)},
            "correlationId": request.state.correlation_id,
        },
    )


def _get_or_404(store: AwsStore, table: str, tenant_id: str, record_id: str) -> dict[str, Any]:
    item = store.get(table, tenant_id, record_id)
    if not item:
        raise HTTPException(status_code=404, detail=f"{table[:-1]} not found")
    return item


def _idempotency_existing(
    store: AwsStore, tenant_id: str, operation: str, key: str
) -> dict[str, Any] | None:
    token = hashlib.sha256(f"{tenant_id}:{operation}:{key}".encode()).hexdigest()
    return store.get("idempotency", tenant_id, token)


def _record_idempotency(
    store: AwsStore,
    tenant_id: str,
    operation: str,
    key: str,
    result: dict[str, Any],
) -> None:
    token = hashlib.sha256(f"{tenant_id}:{operation}:{key}".encode()).hexdigest()
    try:
        store.put(
            "idempotency",
            {
                "tenantId": tenant_id,
                "recordId": token,
                "operation": operation,
                "result": result,
                "expiresAt": int((now() + timedelta(days=1)).timestamp()),
            },
            "attribute_not_exists(recordId)",
        )
    except ClientError as error:
        if not is_conditional_failure(error):
            raise


@app.get("/v1/time")
def get_time() -> dict[str, Any]:
    server_time = now()
    return {
        "serverTime": server_time.isoformat(),
        "unixTimeMs": int(server_time.timestamp() * 1000),
    }


@app.get("/v1/facilities", response_model=Page)
def facilities(
    user: CurrentUser,
    store: Store,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    cursor: Annotated[str | None, Query(max_length=2048)] = None,
) -> Page:
    items, next_cursor = store.query(
        "facilities", "byTenantCreated", "tenantId", user.tenant_id, limit=limit, cursor=cursor
    )
    if "ADMIN" not in user.groups:
        items = [item for item in items if item["recordId"] in user.facility_ids]
    return Page(items=items, next_cursor=next_cursor)


@app.post("/v1/facilities", status_code=201)
def create_facility(
    body: FacilityCreate,
    user: Annotated[Any, Depends(require_roles("ADMIN"))],
    store: Store,
) -> dict[str, Any]:
    try:
        ZoneInfo(body.timezone)
    except ZoneInfoNotFoundError as error:
        raise HTTPException(status_code=400, detail="unknown IANA timezone") from error
    facility_id = new_id("fac")
    item = {
        "tenantId": user.tenant_id,
        "recordId": facility_id,
        "name": body.name,
        "timezone": body.timezone,
        "createdAt": now().isoformat(),
    }
    store.put("facilities", item, "attribute_not_exists(recordId)")
    return item


@app.get("/v1/facilities/{facility_id}/stations", response_model=Page)
def stations(
    facility_id: str,
    user: CurrentUser,
    store: Store,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    cursor: Annotated[str | None, Query(max_length=2048)] = None,
) -> Page:
    authorize_facility(user, facility_id)
    items, next_cursor = store.query(
        "stations", "byFacilityCreated", "facilityId", facility_id, limit=limit, cursor=cursor
    )
    return Page(items=items, next_cursor=next_cursor)


@app.post("/v1/facilities/{facility_id}/stations", status_code=201)
def create_station(
    facility_id: str,
    body: StationCreate,
    user: Annotated[Any, Depends(require_roles("ADMIN"))],
    store: Store,
) -> dict[str, Any]:
    authorize_facility(user, facility_id)
    _get_or_404(store, "facilities", user.tenant_id, facility_id)
    item = {
        "tenantId": user.tenant_id,
        "recordId": new_id("sta"),
        "facilityId": facility_id,
        **body.model_dump(mode="json"),
        "createdAt": now().isoformat(),
    }
    store.put("stations", item, "attribute_not_exists(recordId)")
    return item


@app.post("/v1/stations/{station_id}/heartbeat")
def station_heartbeat(
    station_id: str,
    body: HeartbeatRequest,
    user: Annotated[Any, Depends(require_roles("OPERATOR"))],
    store: Store,
) -> dict[str, Any]:
    station = _get_or_404(store, "stations", user.tenant_id, station_id)
    authorize_facility(user, station["facilityId"])
    updated = store.update(
        "stations",
        user.tenant_id,
        station_id,
        "SET lastHeartbeatAt=:at, armed=:armed, cameraDeviceHash=:camera",
        {":at": now().isoformat(), ":armed": body.armed, ":camera": body.camera_device_hash or ""},
    )
    return {"stationId": station_id, "lastHeartbeatAt": updated["lastHeartbeatAt"]}


@app.post("/v1/captures", response_model=CaptureCreated, status_code=201)
def create_capture(
    body: CaptureCreate,
    request: Request,
    user: Annotated[Any, Depends(require_roles("OPERATOR"))],
    store: Store,
    idempotency_key: Annotated[IdempotencyKey, Header(alias="Idempotency-Key")],
) -> CaptureCreated:
    authorize_facility(user, body.facility_id)
    existing = _idempotency_existing(store, user.tenant_id, "create-capture", idempotency_key)
    if existing:
        return CaptureCreated.model_validate(existing["result"])
    station = _get_or_404(store, "stations", user.tenant_id, body.station_id)
    if station["facilityId"] != body.facility_id:
        raise HTTPException(status_code=400, detail="station does not belong to facility")
    facility = _get_or_404(store, "facilities", user.tenant_id, body.facility_id)
    capture_id = new_id("cap")
    received = now()
    estimated = body.captured_at_client + timedelta(milliseconds=body.client_clock_offset_ms)
    frame_keys = [
        f"{user.tenant_id}/{body.facility_id}/{received:%Y/%m/%d}/{capture_id}/frame-{index}.jpg"
        for index in range(body.frame_count)
    ]
    correlation = request.state.correlation_id
    item = {
        "tenantId": user.tenant_id,
        "recordId": capture_id,
        "facilityId": body.facility_id,
        "stationId": body.station_id,
        "direction": station["direction"],
        "facilityTimezone": facility["timezone"],
        "status": CaptureStatus.UPLOADING,
        "frameKeys": frame_keys,
        "capturedAtClient": body.captured_at_client.isoformat(),
        "estimatedCapturedAtServer": estimated.isoformat(),
        "receivedAtServer": received.isoformat(),
        "correlationId": correlation,
        "createdAt": received.isoformat(),
        "facilityStatus": f"{body.facility_id}#{CaptureStatus.UPLOADING}",
    }
    store.put("captures", item, "attribute_not_exists(recordId)")
    uploads = []
    for index, key in enumerate(frame_keys):
        post = store.create_presigned_post(key, capture_id)
        uploads.append(
            PresignedFrame(
                frame_index=index,
                key=key,
                url=post["url"],
                fields=post["fields"],
                expires_in=settings.presigned_expiration_seconds,
            )
        )
    result = CaptureCreated(
        capture_id=capture_id,
        status="UPLOADING",
        uploads=uploads,
        received_at_server=received,
        estimated_captured_at_server=estimated,
        correlation_id=correlation,
    )
    _record_idempotency(
        store,
        user.tenant_id,
        "create-capture",
        idempotency_key,
        result.model_dump(mode="json", by_alias=True),
    )
    metrics.add_metric(name="CapturesCreated", unit=MetricUnit.Count, value=1)
    return result


@app.post("/v1/captures/{capture_id}/complete")
def complete_capture(
    capture_id: str,
    body: CaptureComplete,
    user: Annotated[Any, Depends(require_roles("OPERATOR"))],
    store: Store,
    idempotency_key: Annotated[IdempotencyKey, Header(alias="Idempotency-Key")],
) -> dict[str, Any]:
    existing = _idempotency_existing(store, user.tenant_id, "complete-capture", idempotency_key)
    if existing:
        return dict(existing["result"])
    capture = _get_or_404(store, "captures", user.tenant_id, capture_id)
    authorize_facility(user, capture["facilityId"])
    if body.uploaded_keys != capture["frameKeys"]:
        raise HTTPException(status_code=400, detail="uploaded keys do not match the upload session")
    uploaded_at = now()
    for key in capture["frameKeys"]:
        try:
            store.head_frame(key, capture_id)
        except (ClientError, ValueError) as error:
            raise HTTPException(
                status_code=409, detail=f"frame verification failed: {error}"
            ) from error
    try:
        updated = store.update(
            "captures",
            user.tenant_id,
            capture_id,
            "SET #status=:queued, uploadedAt=:uploaded, facilityStatus=:index",
            {
                ":queued": CaptureStatus.QUEUED,
                ":uploaded": uploaded_at.isoformat(),
                ":index": f"{capture['facilityId']}#{CaptureStatus.QUEUED}",
                ":uploading": CaptureStatus.UPLOADING,
            },
            names={"#status": "status"},
            condition="#status=:uploading",
        )
    except ClientError as error:
        if not is_conditional_failure(error):
            raise
        current = _get_or_404(store, "captures", user.tenant_id, capture_id)
        if current["status"] != CaptureStatus.QUEUED:
            raise HTTPException(status_code=409, detail="capture cannot be completed") from error
        updated = current
    job = {
        "schema_version": "1.0",
        "capture_id": capture_id,
        "tenant_id": user.tenant_id,
        "facility_id": capture["facilityId"],
        "station_id": capture["stationId"],
        "direction": capture["direction"],
        "correlation_id": capture["correlationId"],
        "s3_bucket": settings.capture_bucket,
        "s3_keys": capture["frameKeys"],
        "captured_at_client": capture["capturedAtClient"],
        "estimated_captured_at_server": capture["estimatedCapturedAtServer"],
        "received_at_server": capture["receivedAtServer"],
        "facility_timezone": capture["facilityTimezone"],
    }
    message_id = store.enqueue(job)
    result = {"captureId": capture_id, "status": updated["status"], "messageId": message_id}
    _record_idempotency(store, user.tenant_id, "complete-capture", idempotency_key, result)
    return result


@app.get("/v1/captures/{capture_id}")
def capture(capture_id: str, user: CurrentUser, store: Store) -> dict[str, Any]:
    item = _get_or_404(store, "captures", user.tenant_id, capture_id)
    authorize_facility(user, item["facilityId"])
    item.pop("frameKeys", None)
    return item


@app.post("/v1/captures/{capture_id}/retry")
def retry_capture(
    capture_id: str,
    user: Annotated[Any, Depends(require_roles("OPERATOR"))],
    store: Store,
    idempotency_key: Annotated[IdempotencyKey, Header(alias="Idempotency-Key")],
) -> dict[str, Any]:
    existing = _idempotency_existing(store, user.tenant_id, "retry-capture", idempotency_key)
    if existing:
        return dict(existing["result"])
    capture = _get_or_404(store, "captures", user.tenant_id, capture_id)
    authorize_facility(user, capture["facilityId"])
    if capture["status"] != CaptureStatus.FAILED:
        raise HTTPException(status_code=409, detail="only failed captures can be retried")
    job = {
        "schema_version": "1.0",
        "capture_id": capture_id,
        "tenant_id": user.tenant_id,
        "facility_id": capture["facilityId"],
        "station_id": capture["stationId"],
        "direction": capture["direction"],
        "correlation_id": capture["correlationId"],
        "s3_bucket": settings.capture_bucket,
        "s3_keys": capture["frameKeys"],
        "captured_at_client": capture["capturedAtClient"],
        "estimated_captured_at_server": capture["estimatedCapturedAtServer"],
        "received_at_server": capture["receivedAtServer"],
        "facility_timezone": capture["facilityTimezone"],
    }
    message_id = store.enqueue(job)
    store.update(
        "captures",
        user.tenant_id,
        capture_id,
        "SET #status=:queued, retryCount=if_not_exists(retryCount,:zero)+:one",
        {":queued": CaptureStatus.QUEUED, ":zero": 0, ":one": 1, ":failed": CaptureStatus.FAILED},
        names={"#status": "status"},
        condition="#status=:failed",
    )
    result = {"captureId": capture_id, "status": "QUEUED", "messageId": message_id}
    _record_idempotency(store, user.tenant_id, "retry-capture", idempotency_key, result)
    return result


def _facility_page(
    store: AwsStore,
    table: str,
    facility_id: str,
    limit: int,
    cursor: str | None,
) -> Page:
    items, next_cursor = store.query(
        table, "byFacilityTime", "facilityId", facility_id, limit=limit, cursor=cursor
    )
    return Page(items=items, next_cursor=next_cursor)


@app.get("/v1/observations", response_model=Page)
def observations(
    user: CurrentUser,
    store: Store,
    facility_id: Annotated[str, Query(alias="facilityId", min_length=10, max_length=64)],
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    cursor: Annotated[str | None, Query(max_length=2048)] = None,
) -> Page:
    authorize_facility(user, facility_id)
    page = _facility_page(store, "observations", facility_id, limit, cursor)
    for item in page.items:
        item.pop("derivedCropKeys", None)
        item.pop("rawCandidates", None)
        if not user.groups.intersection({"ADMIN", "SECURITY"}):
            item.pop("normalizedPlate", None)
    return page


@app.get("/v1/observations/{observation_id}")
def observation(observation_id: str, user: CurrentUser, store: Store) -> dict[str, Any]:
    item = _get_or_404(store, "observations", user.tenant_id, observation_id)
    authorize_facility(user, item["facilityId"])
    derived_keys = item.pop("derivedCropKeys", [])
    if user.groups.intersection({"ADMIN", "SECURITY"}) and item.get("mediaAvailable", False):
        capture_item = _get_or_404(store, "captures", user.tenant_id, item["captureId"])
        keys = capture_item.get("frameKeys", []) + derived_keys
        item["mediaUrls"] = [
            {
                "url": store.presign_media(key),
                "expiresIn": settings.media_url_expiration_seconds,
            }
            for key in keys
        ]
    else:
        item.pop("normalizedPlate", None)
        item.pop("rawCandidates", None)
    return item


@app.post("/v1/observations/{observation_id}/review")
def review_observation(
    observation_id: str,
    body: ObservationReview,
    user: Annotated[Any, Depends(require_roles("SECURITY"))],
    store: Store,
    idempotency_key: Annotated[IdempotencyKey, Header(alias="Idempotency-Key")],
) -> dict[str, Any]:
    existing = _idempotency_existing(store, user.tenant_id, "review-observation", idempotency_key)
    if existing:
        return dict(existing["result"])
    item = _get_or_404(store, "observations", user.tenant_id, observation_id)
    authorize_facility(user, item["facilityId"])
    corrected = normalize_plate(body.corrected_plate or "") if body.corrected_plate else None
    if body.decision.value == "CORRECTED" and not corrected:
        raise HTTPException(status_code=400, detail="a valid corrected plate is required")
    reviewed_at = now().isoformat()
    values = {
        ":decision": body.decision.value,
        ":plate": corrected or item.get("normalizedPlate", ""),
        ":note": body.note,
        ":user": user.subject,
        ":at": reviewed_at,
        ":pending": "PENDING",
    }
    try:
        updated = store.update(
            "observations",
            user.tenant_id,
            observation_id,
            "SET reviewDecision=:decision, normalizedPlate=:plate, reviewNote=:note, "
            "reviewedBy=:user, reviewedAt=:at",
            values,
            condition="attribute_not_exists(reviewDecision) OR reviewDecision=:pending",
        )
    except ClientError as error:
        if is_conditional_failure(error):
            raise HTTPException(
                status_code=409, detail="observation was already reviewed"
            ) from error
        raise
    audit_id = new_id("aud")
    store.put(
        "audit",
        {
            "tenantId": user.tenant_id,
            "recordId": audit_id,
            "actorId": user.subject,
            "action": "OBSERVATION_REVIEWED",
            "resourceId": observation_id,
            "facilityId": item["facilityId"],
            "occurredAt": reviewed_at,
            "details": {"decision": body.decision.value},
        },
    )
    result = {"observationId": observation_id, "reviewDecision": updated["reviewDecision"]}
    _record_idempotency(store, user.tenant_id, "review-observation", idempotency_key, result)
    return result


@app.post("/v1/observations/{observation_id}/delete-media")
def delete_observation_media(
    observation_id: str,
    user: Annotated[Any, Depends(require_roles("SECURITY"))],
    store: Store,
) -> dict[str, Any]:
    item = _get_or_404(store, "observations", user.tenant_id, observation_id)
    authorize_facility(user, item["facilityId"])
    capture = _get_or_404(store, "captures", user.tenant_id, item["captureId"])
    store.delete_media(capture.get("frameKeys", []))
    deleted_at = now().isoformat()
    store.update(
        "observations",
        user.tenant_id,
        observation_id,
        "SET mediaDeletedAt=:at, mediaAvailable=:false",
        {":at": deleted_at, ":false": False},
    )
    store.put(
        "audit",
        {
            "tenantId": user.tenant_id,
            "recordId": new_id("aud"),
            "actorId": user.subject,
            "action": "OBSERVATION_MEDIA_DELETED",
            "resourceId": observation_id,
            "facilityId": item["facilityId"],
            "occurredAt": deleted_at,
        },
    )
    return {"observationId": observation_id, "mediaDeletedAt": deleted_at}


@app.get("/v1/visits", response_model=Page)
def visits(
    user: CurrentUser,
    store: Store,
    facility_id: Annotated[str, Query(alias="facilityId", min_length=10, max_length=64)],
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    cursor: Annotated[str | None, Query(max_length=2048)] = None,
) -> Page:
    authorize_facility(user, facility_id)
    return _facility_page(store, "visits", facility_id, limit, cursor)


@app.get("/v1/visits/open", response_model=Page)
def open_visits(
    user: CurrentUser,
    store: Store,
    facility_id: Annotated[str, Query(alias="facilityId", min_length=10, max_length=64)],
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    cursor: Annotated[str | None, Query(max_length=2048)] = None,
) -> Page:
    authorize_facility(user, facility_id)
    items, next_cursor = store.query(
        "visits",
        "byFacilityOpen",
        "facilityOpen",
        f"{facility_id}#OPEN",
        limit=limit,
        cursor=cursor,
    )
    return Page(items=items, next_cursor=next_cursor)


@app.get("/v1/visits/{visit_id}")
def visit(visit_id: str, user: CurrentUser, store: Store) -> dict[str, Any]:
    item = _get_or_404(store, "visits", user.tenant_id, visit_id)
    authorize_facility(user, item["facilityId"])
    return item


@app.get("/v1/registrations", response_model=Page)
def registrations(
    user: CurrentUser,
    store: Store,
    facility_id: Annotated[str, Query(alias="facilityId", min_length=10, max_length=64)],
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    cursor: Annotated[str | None, Query(max_length=2048)] = None,
) -> Page:
    authorize_facility(user, facility_id)
    items, next_cursor = store.query(
        "registrations",
        "byFacilityPlate",
        "authorizationScope",
        f"{user.tenant_id}#{facility_id}",
        limit=limit,
        cursor=cursor,
    )
    return Page(items=items, next_cursor=next_cursor)


@app.post("/v1/registrations", status_code=201)
def create_registration(
    body: RegistrationCreate,
    user: Annotated[Any, Depends(require_roles("SECURITY"))],
    store: Store,
) -> dict[str, Any]:
    normalized = normalize_plate(body.normalized_plate)
    if not normalized:
        raise HTTPException(status_code=400, detail="invalid normalized plate")
    if body.facility_id:
        authorize_facility(user, body.facility_id)
    record = {
        "tenantId": user.tenant_id,
        "recordId": new_id("reg"),
        "normalizedPlate": normalized,
        "displayPlate": body.display_plate,
        "facilityId": body.facility_id,
        "authorizationScope": f"{user.tenant_id}#{body.facility_id or '*'}",
        "tenantPlate": f"{user.tenant_id}#{normalized}",
        "plateRegion": body.plate_region,
        "description": body.description,
        "validFrom": body.valid_from.isoformat(),
        "validUntil": body.valid_until.isoformat() if body.valid_until else None,
        "status": body.status,
        "createdAt": now().isoformat(),
        "createdBy": user.subject,
    }
    store.put("registrations", record, "attribute_not_exists(recordId)")
    return record


@app.patch("/v1/registrations/{registration_id}")
def patch_registration(
    registration_id: str,
    body: RegistrationPatch,
    user: Annotated[Any, Depends(require_roles("SECURITY"))],
    store: Store,
) -> dict[str, Any]:
    item = _get_or_404(store, "registrations", user.tenant_id, registration_id)
    if item.get("facilityId"):
        authorize_facility(user, item["facilityId"])
    changes = body.model_dump(exclude_none=True, mode="json", by_alias=True)
    if not changes:
        return item
    names = {f"#n{index}": key for index, key in enumerate(changes)}
    values = {f":v{index}": value for index, value in enumerate(changes.values())}
    assignments = ", ".join(f"#n{index}=:v{index}" for index in range(len(changes)))
    values[":updatedAt"] = now().isoformat()
    values[":updatedBy"] = user.subject
    return store.update(
        "registrations",
        user.tenant_id,
        registration_id,
        f"SET {assignments}, updatedAt=:updatedAt, updatedBy=:updatedBy",
        values,
        names=names,
    )


@app.delete("/v1/registrations/{registration_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_registration(
    registration_id: str,
    user: Annotated[Any, Depends(require_roles("SECURITY"))],
    store: Store,
) -> None:
    item = _get_or_404(store, "registrations", user.tenant_id, registration_id)
    if item.get("facilityId"):
        authorize_facility(user, item["facilityId"])
    store.delete("registrations", user.tenant_id, registration_id)


@app.get("/v1/alerts", response_model=Page)
def alerts(
    user: Annotated[Any, Depends(require_roles("SECURITY"))],
    store: Store,
    facility_id: Annotated[str, Query(alias="facilityId", min_length=10, max_length=64)],
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    cursor: Annotated[str | None, Query(max_length=2048)] = None,
) -> Page:
    authorize_facility(user, facility_id)
    return _facility_page(store, "alerts", facility_id, limit, cursor)


def _transition_alert(
    alert_id: str,
    target: str,
    user: Any,
    store: AwsStore,
) -> dict[str, Any]:
    alert = _get_or_404(store, "alerts", user.tenant_id, alert_id)
    authorize_facility(user, alert["facilityId"])
    transition_at = now().isoformat()
    allowed = ["OPEN"] if target == "ACKNOWLEDGED" else ["OPEN", "ACKNOWLEDGED"]
    if alert["status"] not in allowed:
        raise HTTPException(status_code=409, detail=f"alert cannot transition to {target}")
    return store.update(
        "alerts",
        user.tenant_id,
        alert_id,
        "SET #status=:target, statusActor=:actor, statusChangedAt=:at",
        {":target": target, ":actor": user.subject, ":at": transition_at},
        names={"#status": "status"},
    )


@app.post("/v1/alerts/{alert_id}/acknowledge")
def acknowledge_alert(
    alert_id: str,
    user: Annotated[Any, Depends(require_roles("SECURITY"))],
    store: Store,
) -> dict[str, Any]:
    return _transition_alert(alert_id, "ACKNOWLEDGED", user, store)


@app.post("/v1/alerts/{alert_id}/resolve")
def resolve_alert(
    alert_id: str,
    user: Annotated[Any, Depends(require_roles("SECURITY"))],
    store: Store,
) -> dict[str, Any]:
    return _transition_alert(alert_id, "RESOLVED", user, store)


@app.get("/v1/system/health")
def system_health(
    user: Annotated[Any, Depends(require_roles("ADMIN"))],
) -> dict[str, Any]:
    return {
        "status": "ok",
        "service": "control-api",
        "environment": settings.environment,
        "time": now().isoformat(),
        "tenantId": user.tenant_id,
    }


@app.get("/v1/system/dlq")
def dlq(
    user: Annotated[Any, Depends(require_roles("ADMIN"))],
    store: Store,
) -> dict[str, Any]:
    return {"messages": store.dlq_messages(), "tenantId": user.tenant_id}


@app.post("/v1/system/dlq/{message_id}/redrive")
def redrive_dlq(
    message_id: str,
    user: Annotated[Any, Depends(require_roles("ADMIN"))],
    store: Store,
) -> dict[str, Any]:
    try:
        store.redrive(message_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    return {"messageId": message_id, "status": "REDRIVEN", "actorId": user.subject}


handler = Mangum(app, lifespan="off")
