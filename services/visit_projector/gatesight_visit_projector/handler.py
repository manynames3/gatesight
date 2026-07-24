"""EventBridge consumer that pairs recognized entries and exits."""

from __future__ import annotations

import hashlib
import os
from datetime import UTC, datetime, timedelta
from typing import Any

import boto3
from aws_lambda_powertools import Logger, Metrics, Tracer
from aws_lambda_powertools.metrics import MetricUnit
from aws_lambda_powertools.utilities.parameters import get_parameter
from boto3.dynamodb.types import TypeSerializer
from botocore.exceptions import ClientError
from gatesight_domain.models import DomainEvent, ObservationState
from gatesight_domain.visits import project_visit

logger = Logger(service="visit-projector")
tracer = Tracer(service="visit-projector")
metrics = Metrics(namespace="GateSight", service="visit-projector")
REGION = os.getenv("AWS_REGION", "us-east-1")
TABLE_PREFIX = os.getenv("GATESIGHT_TABLE_PREFIX", "gatesight-local")
CONFIG_PREFIX = os.getenv("GATESIGHT_CONFIG_PREFIX", "")
DUPLICATE_WINDOW_SECONDS = int(
    get_parameter(f"{CONFIG_PREFIX}/duplicate-window", max_age=300, decrypt=True)
    if CONFIG_PREFIX
    else os.getenv("GATESIGHT_DUPLICATE_WINDOW_SECONDS", "30")
)
session = boto3.session.Session(region_name=REGION)
dynamodb = session.resource("dynamodb")
dynamodb_client = session.client("dynamodb")
serializer = TypeSerializer()


def _serialize(item: dict[str, Any]) -> dict[str, Any]:
    return {key: serializer.serialize(value) for key, value in item.items()}


def _plate_state_id(tenant_id: str, facility_id: str, normalized_plate: str) -> str:
    digest = hashlib.sha256(f"{tenant_id}:{facility_id}:{normalized_plate}".encode()).hexdigest()
    return f"state_{digest}"


def _event_marker_id(event_id: str) -> str:
    return f"event_{hashlib.sha256(event_id.encode()).hexdigest()}"


@tracer.capture_method
def project(event: DomainEvent) -> None:
    if event.data.state is not ObservationState.RECOGNIZED:
        return
    observations = dynamodb.Table(f"{TABLE_PREFIX}-observations")
    observation = observations.get_item(
        Key={"tenantId": event.tenant_id, "recordId": event.data.observation_id},
        ConsistentRead=True,
    ).get("Item")
    if not observation or not observation.get("normalizedPlate"):
        raise RuntimeError("recognized observation is unavailable")
    observed_at = event.data.captured_at
    state_id = _plate_state_id(
        event.tenant_id, event.data.facility_id, observation["normalizedPlate"]
    )
    visits = dynamodb.Table(f"{TABLE_PREFIX}-visits")
    state = visits.get_item(
        Key={"tenantId": event.tenant_id, "recordId": state_id}, ConsistentRead=True
    ).get("Item")
    last_at = datetime.fromisoformat(state["lastObservationAt"]) if state else None
    duplicate = bool(
        state
        and state.get("lastDirection") == event.data.direction.value
        and last_at
        and abs((observed_at - last_at).total_seconds()) <= DUPLICATE_WINDOW_SECONDS
    )
    open_started_at = (
        datetime.fromisoformat(state["openStartedAt"])
        if state and state.get("openStartedAt")
        else None
    )
    outcome = project_visit(
        direction=event.data.direction,
        observed_at=observed_at,
        open_visit_started_at=open_started_at,
        duplicate=duplicate,
    )
    marker = {
        "tenantId": event.tenant_id,
        "recordId": _event_marker_id(event.id),
        "recordType": "EVENT_MARKER",
        "eventId": event.id,
        "expiresAt": int((datetime.now(UTC) + timedelta(days=30)).timestamp()),
    }
    transactions: list[dict[str, Any]] = [
        {
            "Put": {
                "TableName": f"{TABLE_PREFIX}-visits",
                "Item": _serialize(marker),
                "ConditionExpression": "attribute_not_exists(recordId)",
            }
        }
    ]
    if outcome.action == "OPENED":
        visit_id = f"vis_{event.data.observation_id.removeprefix('obs_')}"
        visit = {
            "tenantId": event.tenant_id,
            "recordId": visit_id,
            "recordType": "VISIT",
            "facilityId": event.data.facility_id,
            "normalizedPlate": observation["normalizedPlate"],
            "entryObservationId": event.data.observation_id,
            "entryAt": observed_at.isoformat(),
            "status": "OPEN",
            "facilityOpen": f"{event.data.facility_id}#OPEN",
            "createdAt": datetime.now(UTC).isoformat(),
        }
        new_state = {
            "tenantId": event.tenant_id,
            "recordId": state_id,
            "recordType": "PLATE_STATE",
            "facilityId": event.data.facility_id,
            "openVisitId": visit_id,
            "openStartedAt": observed_at.isoformat(),
            "lastObservationAt": observed_at.isoformat(),
            "lastDirection": event.data.direction.value,
        }
        transactions.extend(
            [
                {
                    "Put": {
                        "TableName": f"{TABLE_PREFIX}-visits",
                        "Item": _serialize(visit),
                        "ConditionExpression": "attribute_not_exists(recordId)",
                    }
                },
                {
                    "Put": {
                        "TableName": f"{TABLE_PREFIX}-visits",
                        "Item": _serialize(new_state),
                        "ConditionExpression": (
                            "attribute_not_exists(openVisitId) OR attribute_not_exists(recordId)"
                        ),
                    }
                },
            ]
        )
    elif outcome.action == "CLOSED":
        if state is None:
            raise RuntimeError("visit projection requested closure without open state")
        visit_id = state["openVisitId"]
        transactions.extend(
            [
                {
                    "Update": {
                        "TableName": f"{TABLE_PREFIX}-visits",
                        "Key": _serialize({"tenantId": event.tenant_id, "recordId": visit_id}),
                        "UpdateExpression": (
                            "SET #status=:closed, exitObservationId=:observation, exitAt=:at, "
                            "dwellSeconds=:dwell, facilityOpen=:closed_index"
                        ),
                        "ConditionExpression": "#status=:open",
                        "ExpressionAttributeNames": {"#status": "status"},
                        "ExpressionAttributeValues": _serialize(
                            {
                                ":closed": "CLOSED",
                                ":open": "OPEN",
                                ":observation": event.data.observation_id,
                                ":at": observed_at.isoformat(),
                                ":dwell": outcome.dwell_seconds or 0,
                                ":closed_index": f"{event.data.facility_id}#CLOSED",
                            }
                        ),
                    }
                },
                {
                    "Update": {
                        "TableName": f"{TABLE_PREFIX}-visits",
                        "Key": _serialize({"tenantId": event.tenant_id, "recordId": state_id}),
                        "UpdateExpression": (
                            "REMOVE openVisitId, openStartedAt SET "
                            "lastObservationAt=:at, lastDirection=:direction"
                        ),
                        "ConditionExpression": "openVisitId=:visit",
                        "ExpressionAttributeValues": _serialize(
                            {
                                ":at": observed_at.isoformat(),
                                ":direction": event.data.direction.value,
                                ":visit": visit_id,
                            }
                        ),
                    }
                },
            ]
        )
    else:
        anomaly_id = f"anomaly_{event.data.observation_id.removeprefix('obs_')}"
        anomaly = {
            "tenantId": event.tenant_id,
            "recordId": anomaly_id,
            "recordType": "ANOMALY",
            "facilityId": event.data.facility_id,
            "observationId": event.data.observation_id,
            "anomaly": outcome.anomaly or "DUPLICATE_SUPPRESSED",
            "occurredAt": observed_at.isoformat(),
            "createdAt": datetime.now(UTC).isoformat(),
        }
        transactions.append(
            {
                "Put": {
                    "TableName": f"{TABLE_PREFIX}-visits",
                    "Item": _serialize(anomaly),
                    "ConditionExpression": "attribute_not_exists(recordId)",
                }
            }
        )
    try:
        dynamodb_client.transact_write_items(TransactItems=transactions)
    except ClientError as error:
        if error.response.get("Error", {}).get("Code") == "TransactionCanceledException":
            marker_exists = visits.get_item(
                Key={"tenantId": event.tenant_id, "recordId": _event_marker_id(event.id)},
                ConsistentRead=True,
            ).get("Item")
            if marker_exists:
                logger.info("duplicate EventBridge delivery ignored")
                return
        raise
    metrics.add_metric(name="VisitProjectionEvents", unit=MetricUnit.Count, value=1)
    if outcome.action == "ANOMALY":
        metrics.add_metric(name="VisitAnomalies", unit=MetricUnit.Count, value=1)


@logger.inject_lambda_context(clear_state=True, log_event=False)
@tracer.capture_lambda_handler
@metrics.log_metrics(capture_cold_start_metric=True)
def handler(raw_event: dict[str, Any], context: Any) -> None:
    event = DomainEvent.model_validate(raw_event.get("detail", raw_event))
    logger.append_keys(
        correlation_id=event.correlation_id,
        tenant_id=event.tenant_id,
        facility_id=event.data.facility_id,
        observation_id=event.data.observation_id,
    )
    project(event)
