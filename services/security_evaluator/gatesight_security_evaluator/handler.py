"""EventBridge consumer enforcing the no-alert-from-uncertainty invariant."""

from __future__ import annotations

import hashlib
import json
import os
from datetime import UTC, datetime
from typing import Any

import boto3
from aws_lambda_powertools import Logger, Metrics, Tracer
from aws_lambda_powertools.metrics import MetricUnit
from aws_lambda_powertools.utilities.parameters import get_parameter
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError
from gatesight_domain.models import (
    DomainEvent,
    RegistrationStatus,
)
from gatesight_domain.normalization import mask_plate
from gatesight_domain.security import evaluate_alert

logger = Logger(service="security-evaluator")
tracer = Tracer(service="security-evaluator")
metrics = Metrics(namespace="GateSight", service="security-evaluator")
REGION = os.getenv("AWS_REGION", "us-east-1")
TABLE_PREFIX = os.getenv("GATESIGHT_TABLE_PREFIX", "gatesight-local")
CONFIG_PREFIX = os.getenv("GATESIGHT_CONFIG_PREFIX", "")
ALERT_WINDOW_SECONDS = int(
    get_parameter(f"{CONFIG_PREFIX}/alert-suppression", max_age=300, decrypt=True)
    if CONFIG_PREFIX
    else os.getenv("GATESIGHT_ALERT_SUPPRESSION_SECONDS", "900")
)
HIGH_CONFIDENCE = float(
    get_parameter(f"{CONFIG_PREFIX}/high-confidence", max_age=300, decrypt=True)
    if CONFIG_PREFIX
    else os.getenv("GATESIGHT_HIGH_CONFIDENCE", "0.88")
)
SNS_TOPIC_ARN = os.getenv("GATESIGHT_SECURITY_TOPIC_ARN", "")
DASHBOARD_URL = os.getenv("GATESIGHT_DASHBOARD_URL", "")
session = boto3.session.Session(region_name=REGION)
dynamodb = session.resource("dynamodb")
sns = session.client("sns")


def _active_registration(
    tenant_id: str,
    facility_id: str,
    normalized_plate: str,
    at: datetime,
) -> RegistrationStatus | None:
    table = dynamodb.Table(f"{TABLE_PREFIX}-registrations")
    response = table.query(
        IndexName="byPlate",
        KeyConditionExpression=Key("tenantPlate").eq(f"{tenant_id}#{normalized_plate}"),
        ConsistentRead=False,
    )
    statuses: list[RegistrationStatus] = []
    for item in response.get("Items", []):
        if item.get("facilityId") not in {None, facility_id}:
            continue
        valid_from = datetime.fromisoformat(item["validFrom"])
        valid_until = datetime.fromisoformat(item["validUntil"]) if item.get("validUntil") else None
        if valid_from <= at and (valid_until is None or at <= valid_until):
            statuses.append(RegistrationStatus(item["status"]))
    if RegistrationStatus.BLOCKED in statuses:
        return RegistrationStatus.BLOCKED
    if RegistrationStatus.ACTIVE in statuses:
        return RegistrationStatus.ACTIVE
    return RegistrationStatus.EXPIRED if statuses else None


def _alert_id(
    tenant_id: str,
    facility_id: str,
    normalized_plate: str,
    observed_at: datetime,
) -> str:
    window = int(observed_at.timestamp()) // ALERT_WINDOW_SECONDS
    digest = hashlib.sha256(
        f"{tenant_id}:{facility_id}:{normalized_plate}:{window}".encode()
    ).hexdigest()
    return f"alt_{digest}"


@tracer.capture_method
def evaluate(event: DomainEvent) -> None:
    if event.data.synthetic:
        logger.info("synthetic observation excluded from security evaluation")
        return
    if event.data.confidence_category != "HIGH":
        logger.info("observation is below high-confidence alert threshold")
        return
    observation = (
        dynamodb.Table(f"{TABLE_PREFIX}-observations")
        .get_item(
            Key={"tenantId": event.tenant_id, "recordId": event.data.observation_id},
            ConsistentRead=True,
        )
        .get("Item")
    )
    if not observation or not observation.get("normalizedPlate"):
        raise RuntimeError("recognized observation details are unavailable")
    normalized = observation["normalizedPlate"]
    score = float(observation["consensusScore"])
    registration_status = _active_registration(
        event.tenant_id, event.data.facility_id, normalized, event.data.captured_at
    )
    decision = evaluate_alert(
        direction=event.data.direction,
        state=event.data.state,
        consensus_score=score,
        high_confidence_threshold=HIGH_CONFIDENCE,
        registration_status=registration_status,
    )
    if not decision.create_alert:
        logger.info("security alert suppressed", extra={"reason": decision.reason})
        return
    alert_id = _alert_id(
        event.tenant_id, event.data.facility_id, normalized, event.data.captured_at
    )
    blocked = registration_status is RegistrationStatus.BLOCKED
    item = {
        "tenantId": event.tenant_id,
        "recordId": alert_id,
        "facilityId": event.data.facility_id,
        "observationId": event.data.observation_id,
        "status": "OPEN",
        "reason": "BLOCKED_REGISTRATION" if blocked else "UNREGISTERED_ENTRY",
        "maskedPlate": mask_plate(normalized),
        "confidenceCategory": event.data.confidence_category,
        "occurredAt": event.data.captured_at.isoformat(),
        "createdAt": datetime.now(UTC).isoformat(),
        "facilityStatus": f"{event.data.facility_id}#OPEN",
    }
    try:
        dynamodb.Table(f"{TABLE_PREFIX}-alerts").put_item(
            Item=item, ConditionExpression="attribute_not_exists(recordId)"
        )
    except ClientError as error:
        if error.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException":
            logger.info("duplicate or suppression-window alert ignored")
            return
        raise
    metrics.add_metric(name="SecurityAlertsCreated", unit=MetricUnit.Count, value=1)
    if SNS_TOPIC_ARN:
        message = {
            "type": item["reason"],
            "maskedPlate": item["maskedPlate"],
            "facilityId": event.data.facility_id,
            "timestamp": event.data.captured_at.isoformat(),
            "confidence": event.data.confidence_category,
            "dashboardUrl": f"{DASHBOARD_URL}/alerts/{alert_id}",
        }
        try:
            sns.publish(
                TopicArn=SNS_TOPIC_ARN,
                Subject="GateSight security alert",
                Message=json.dumps(message, separators=(",", ":")),
            )
        except ClientError:
            metrics.add_metric(name="AlertDeliveryFailures", unit=MetricUnit.Count, value=1)
            raise


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
    evaluate(event)
