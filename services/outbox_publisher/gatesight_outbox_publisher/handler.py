"""Publish PENDING outbox records from DynamoDB Streams to EventBridge."""

from __future__ import annotations

import json
import os
from datetime import datetime
from typing import Any

import boto3
from aws_lambda_powertools import Logger, Metrics, Tracer
from aws_lambda_powertools.metrics import MetricUnit
from aws_lambda_powertools.utilities.batch import (
    BatchProcessor,
    EventType,
    process_partial_response,
)
from aws_lambda_powertools.utilities.data_classes.dynamo_db_stream_event import (
    DynamoDBRecord,
    DynamoDBRecordEventName,
)
from boto3.dynamodb.types import TypeDeserializer
from botocore.exceptions import ClientError

logger = Logger(service="outbox-publisher")
tracer = Tracer(service="outbox-publisher")
metrics = Metrics(namespace="GateSight", service="outbox-publisher")
processor = BatchProcessor(event_type=EventType.DynamoDBStreams)

REGION = os.getenv("AWS_REGION", "us-east-1")
TABLE_PREFIX = os.getenv("GATESIGHT_TABLE_PREFIX", "gatesight-local")
EVENT_BUS_NAME = os.getenv("GATESIGHT_EVENT_BUS_NAME", "gatesight-local")
session = boto3.session.Session(region_name=REGION)
eventbridge = session.client("events")
dynamodb = session.resource("dynamodb")
deserializer = TypeDeserializer()


def _deserialize(image: dict[str, Any]) -> dict[str, Any]:
    return {key: deserializer.deserialize(value) for key, value in image.items()}


@tracer.capture_method
def record_handler(record: DynamoDBRecord) -> None:
    if record.event_name not in {
        DynamoDBRecordEventName.INSERT,
        DynamoDBRecordEventName.MODIFY,
    }:
        return
    stream_record = record.dynamodb
    if stream_record is None:
        return
    image = stream_record.new_image
    if not image:
        return
    item = _deserialize(dict(image))
    if item.get("status") != "PENDING":
        return
    event = item["event"]
    logger.append_keys(
        correlation_id=event["correlationId"],
        tenant_id=event["tenantId"],
        observation_id=event["data"]["observation_id"],
    )
    response = eventbridge.put_events(
        Entries=[
            {
                "EventBusName": EVENT_BUS_NAME,
                "Source": "gatesight.recognition",
                "DetailType": event["type"],
                "Time": datetime.fromisoformat(event["time"]),
                "Detail": json.dumps(event, separators=(",", ":")),
                "Resources": [],
            }
        ]
    )
    if response.get("FailedEntryCount", 0):
        metrics.add_metric(name="OutboxPublishFailures", unit=MetricUnit.Count, value=1)
        raise RuntimeError("EventBridge rejected the outbox event")
    table = dynamodb.Table(f"{TABLE_PREFIX}-outbox")
    try:
        table.update_item(
            Key={"tenantId": item["tenantId"], "recordId": item["recordId"]},
            UpdateExpression="SET #status=:published, publishedAt=:at ADD publishAttempts :one",
            ConditionExpression="#status=:pending",
            ExpressionAttributeNames={"#status": "status"},
            ExpressionAttributeValues={
                ":published": "PUBLISHED",
                ":pending": "PENDING",
                ":at": event["time"],
                ":one": 1,
            },
        )
    except ClientError as error:
        if error.response.get("Error", {}).get("Code") != "ConditionalCheckFailedException":
            raise
    metrics.add_metric(name="OutboxEventsPublished", unit=MetricUnit.Count, value=1)


@logger.inject_lambda_context(clear_state=True, log_event=False)
@tracer.capture_lambda_handler
@metrics.log_metrics(capture_cold_start_metric=True)
def handler(event: dict[str, Any], context: Any) -> Any:
    return process_partial_response(
        event=event,
        record_handler=record_handler,
        processor=processor,
        context=context,
    )
