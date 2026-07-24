"""Least-surprise DynamoDB/S3/SQS adapter for the control API."""

from __future__ import annotations

import base64
import json
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any

import boto3
from boto3.dynamodb.conditions import Key
from botocore.config import Config
from botocore.exceptions import ClientError

from gatesight_control_api.settings import settings


def _json_default(value: Any) -> Any:
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, datetime):
        return value.isoformat()
    raise TypeError(f"unsupported serialization value: {type(value)!r}")


def _dynamodb_safe(value: Any) -> Any:
    """Convert JSON-compatible floats to DynamoDB's exact decimal representation."""
    if isinstance(value, float):
        return Decimal(str(value))
    if isinstance(value, dict):
        return {key: _dynamodb_safe(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_dynamodb_safe(item) for item in value]
    if isinstance(value, tuple):
        return tuple(_dynamodb_safe(item) for item in value)
    return value


def encode_cursor(key: dict[str, Any] | None) -> str | None:
    if not key:
        return None
    raw = json.dumps(key, default=_json_default, separators=(",", ":")).encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def decode_cursor(cursor: str | None) -> dict[str, Any] | None:
    if not cursor:
        return None
    try:
        padded = cursor + ("=" * (-len(cursor) % 4))
        value = json.loads(base64.urlsafe_b64decode(padded))
    except (ValueError, json.JSONDecodeError) as error:
        raise ValueError("invalid cursor") from error
    if not isinstance(value, dict):
        raise ValueError("invalid cursor")
    return value


class AwsStore:
    def __init__(self) -> None:
        session = boto3.session.Session(region_name=settings.aws_region)
        self.dynamodb = session.resource("dynamodb")
        self.dynamodb_client = session.client("dynamodb")
        self.s3 = session.client(
            "s3",
            config=Config(
                signature_version="s3v4",
                s3={
                    "addressing_style": "virtual",
                    "us_east_1_regional_endpoint": "regional",
                },
            ),
        )
        self.sqs = session.client("sqs")
        self.lambda_client = session.client("lambda")

    def table(self, name: str) -> Any:
        return self.dynamodb.Table(f"{settings.table_prefix}-{name}")

    def put(self, table: str, item: dict[str, Any], condition: str | None = None) -> None:
        arguments: dict[str, Any] = {"Item": _dynamodb_safe(item)}
        if condition:
            arguments["ConditionExpression"] = condition
        self.table(table).put_item(**arguments)

    def get(self, table: str, tenant_id: str, record_id: str) -> dict[str, Any] | None:
        result = self.table(table).get_item(
            Key={"tenantId": tenant_id, "recordId": record_id}, ConsistentRead=True
        )
        item = result.get("Item")
        return dict(item) if isinstance(item, dict) else None

    def update(
        self,
        table: str,
        tenant_id: str,
        record_id: str,
        expression: str,
        values: dict[str, Any],
        *,
        names: dict[str, str] | None = None,
        condition: str | None = None,
        return_values: str = "ALL_NEW",
    ) -> dict[str, Any]:
        arguments: dict[str, Any] = {
            "Key": {"tenantId": tenant_id, "recordId": record_id},
            "UpdateExpression": expression,
            "ExpressionAttributeValues": _dynamodb_safe(values),
            "ReturnValues": return_values,
        }
        if names:
            arguments["ExpressionAttributeNames"] = names
        if condition:
            arguments["ConditionExpression"] = condition
        attributes = self.table(table).update_item(**arguments).get("Attributes", {})
        return dict(attributes) if isinstance(attributes, dict) else {}

    def delete(self, table: str, tenant_id: str, record_id: str) -> None:
        self.table(table).delete_item(
            Key={"tenantId": tenant_id, "recordId": record_id},
            ConditionExpression="attribute_exists(recordId)",
        )

    def query(
        self,
        table: str,
        index: str,
        partition_name: str,
        partition_value: str,
        *,
        limit: int,
        cursor: str | None,
        ascending: bool = False,
    ) -> tuple[list[dict[str, Any]], str | None]:
        arguments: dict[str, Any] = {
            "IndexName": index,
            "KeyConditionExpression": Key(partition_name).eq(partition_value),
            "Limit": limit,
            "ScanIndexForward": ascending,
        }
        start_key = decode_cursor(cursor)
        if start_key:
            arguments["ExclusiveStartKey"] = start_key
        result = self.table(table).query(
            **arguments,
        )
        return result.get("Items", []), encode_cursor(result.get("LastEvaluatedKey"))

    def create_presigned_post(self, key: str, capture_id: str) -> dict[str, Any]:
        return self.s3.generate_presigned_post(
            Bucket=settings.capture_bucket,
            Key=key,
            Fields={
                "Content-Type": "image/jpeg",
                "x-amz-meta-capture-id": capture_id,
            },
            Conditions=[
                {"Content-Type": "image/jpeg"},
                {"x-amz-meta-capture-id": capture_id},
                ["content-length-range", 1, settings.max_frame_bytes],
                ["eq", "$key", key],
            ],
            ExpiresIn=settings.presigned_expiration_seconds,
        )

    def head_frame(self, key: str, capture_id: str) -> dict[str, Any]:
        result = self.s3.head_object(Bucket=settings.capture_bucket, Key=key)
        if result.get("ContentType") != "image/jpeg":
            raise ValueError("invalid uploaded media type")
        if int(result.get("ContentLength", 0)) > settings.max_frame_bytes:
            raise ValueError("uploaded frame is too large")
        if result.get("Metadata", {}).get("capture-id") != capture_id:
            raise ValueError("capture metadata does not match")
        return dict(result)

    def frame_is_verified(self, key: str, capture_id: str) -> bool:
        try:
            self.head_frame(key, capture_id)
        except ValueError:
            return False
        except ClientError as error:
            code = str(error.response.get("Error", {}).get("Code", ""))
            if code in {"404", "NoSuchKey", "NotFound"}:
                return False
            raise
        return True

    def enqueue(self, job: dict[str, Any]) -> str:
        result = self.sqs.send_message(
            QueueUrl=settings.recognition_queue_url,
            MessageBody=json.dumps(job, default=_json_default, separators=(",", ":")),
            MessageAttributes={
                "correlationId": {"DataType": "String", "StringValue": job["correlation_id"]},
                "tenantId": {"DataType": "String", "StringValue": job["tenant_id"]},
            },
        )
        return str(result["MessageId"])

    def delete_media(self, keys: list[str]) -> None:
        if not keys:
            return
        self.s3.delete_objects(
            Bucket=settings.capture_bucket,
            Delete={"Objects": [{"Key": key} for key in keys], "Quiet": True},
        )

    def presign_media(self, key: str) -> str:
        return str(
            self.s3.generate_presigned_url(
                "get_object",
                Params={"Bucket": settings.capture_bucket, "Key": key},
                ExpiresIn=settings.media_url_expiration_seconds,
            )
        )

    def dlq_messages(self, maximum: int = 10) -> list[dict[str, Any]]:
        if not settings.dlq_url:
            return []
        response = self.sqs.receive_message(
            QueueUrl=settings.dlq_url,
            MaxNumberOfMessages=min(maximum, 10),
            VisibilityTimeout=5,
            WaitTimeSeconds=0,
            AttributeNames=["All"],
        )
        messages = response.get("Messages", [])
        return [
            {
                "messageId": message["MessageId"],
                "approximateReceiveCount": message.get("Attributes", {}).get(
                    "ApproximateReceiveCount", "0"
                ),
            }
            for message in messages
        ]

    def queue_summary(self, queue_url: str) -> dict[str, Any]:
        if not queue_url:
            return {
                "configured": False,
                "visible": 0,
                "inFlight": 0,
                "delayed": 0,
            }
        response = self.sqs.get_queue_attributes(
            QueueUrl=queue_url,
            AttributeNames=[
                "ApproximateNumberOfMessages",
                "ApproximateNumberOfMessagesNotVisible",
                "ApproximateNumberOfMessagesDelayed",
            ],
        )
        attributes = response.get("Attributes", {})
        return {
            "configured": True,
            "visible": int(attributes.get("ApproximateNumberOfMessages", "0")),
            "inFlight": int(attributes.get("ApproximateNumberOfMessagesNotVisible", "0")),
            "delayed": int(attributes.get("ApproximateNumberOfMessagesDelayed", "0")),
        }

    def worker_summary(self) -> dict[str, Any]:
        function_name = (
            settings.recognition_worker_function_name
            or f"{settings.table_prefix}-recognition-worker"
        )
        response = self.lambda_client.get_function_configuration(FunctionName=function_name)
        return {
            "functionName": function_name,
            "state": response.get("State", "Unknown"),
            "lastUpdateStatus": response.get("LastUpdateStatus", "Unknown"),
            "lastModified": response.get("LastModified"),
            "memoryMb": response.get("MemorySize"),
            "timeoutSeconds": response.get("Timeout"),
        }

    def _tenant_projection(
        self,
        table: str,
        tenant_id: str,
        projection: str,
        names: dict[str, str] | None = None,
    ) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        exclusive_start_key: dict[str, Any] | None = None
        while True:
            arguments: dict[str, Any] = {
                "KeyConditionExpression": Key("tenantId").eq(tenant_id),
                "ProjectionExpression": projection,
            }
            if names:
                arguments["ExpressionAttributeNames"] = names
            if exclusive_start_key:
                arguments["ExclusiveStartKey"] = exclusive_start_key
            response = self.table(table).query(**arguments)
            items.extend(response.get("Items", []))
            exclusive_start_key = response.get("LastEvaluatedKey")
            if not exclusive_start_key:
                return items

    def outbox_summary(self, tenant_id: str) -> dict[str, Any]:
        items = self._tenant_projection(
            "outbox",
            tenant_id,
            "#status, createdAt",
            {"#status": "status"},
        )
        counts: dict[str, int] = {}
        oldest_pending_at: str | None = None
        for item in items:
            item_status = str(item.get("status", "UNKNOWN"))
            counts[item_status] = counts.get(item_status, 0) + 1
            if item_status == "PENDING":
                created_at = item.get("createdAt")
                if isinstance(created_at, str) and (
                    oldest_pending_at is None or created_at < oldest_pending_at
                ):
                    oldest_pending_at = created_at
        return {
            "pending": counts.get("PENDING", 0),
            "published": counts.get("PUBLISHED", 0),
            "failed": counts.get("FAILED", 0),
            "total": len(items),
            "oldestPendingAt": oldest_pending_at,
        }

    def station_heartbeat_summary(
        self,
        tenant_id: str,
        checked_at: datetime,
        stale_after_seconds: int,
    ) -> dict[str, Any]:
        items = self._tenant_projection(
            "stations",
            tenant_id,
            "recordId, facilityId, #name, commissioned, createdAt, lastHeartbeatAt",
            {"#name": "name"},
        )
        cutoff = checked_at - timedelta(seconds=stale_after_seconds)
        stations = []
        healthy = 0
        for item in items:
            commissioned = item.get("commissioned") is True
            raw_observed = item.get("lastHeartbeatAt") or item.get("createdAt")
            observed: datetime | None = None
            if isinstance(raw_observed, str):
                try:
                    observed = datetime.fromisoformat(raw_observed)
                    if observed.tzinfo is None:
                        observed = observed.replace(tzinfo=UTC)
                except ValueError:
                    observed = None
            station_status = (
                "not_commissioned"
                if not commissioned
                else "healthy"
                if observed and observed >= cutoff
                else "stale"
            )
            healthy += int(station_status == "healthy")
            stations.append(
                {
                    "stationId": item.get("recordId"),
                    "facilityId": item.get("facilityId"),
                    "name": item.get("name"),
                    "lastHeartbeatAt": item.get("lastHeartbeatAt"),
                    "status": station_status,
                    "commissioned": commissioned,
                }
            )
        stations.sort(
            key=lambda station: str(station.get("lastHeartbeatAt") or ""),
            reverse=True,
        )
        commissioned_count = sum(
            1 for station in stations if station["status"] != "not_commissioned"
        )
        return {
            "configured": len(stations),
            "uncommissioned": len(stations) - commissioned_count,
            "total": commissioned_count,
            "healthy": healthy,
            "stale": commissioned_count - healthy,
            "staleAfterSeconds": stale_after_seconds,
            "stations": stations,
        }

    def redrive(self, message_id: str) -> None:
        if not settings.dlq_url:
            raise ValueError("DLQ is not configured")
        response = self.sqs.receive_message(
            QueueUrl=settings.dlq_url,
            MaxNumberOfMessages=10,
            VisibilityTimeout=30,
            WaitTimeSeconds=0,
            AttributeNames=["All"],
        )
        matched = next(
            (
                message
                for message in response.get("Messages", [])
                if message["MessageId"] == message_id
            ),
            None,
        )
        if not matched:
            raise KeyError("DLQ message was not found")
        self.sqs.send_message(QueueUrl=settings.recognition_queue_url, MessageBody=matched["Body"])
        self.sqs.delete_message(QueueUrl=settings.dlq_url, ReceiptHandle=matched["ReceiptHandle"])


def is_conditional_failure(error: ClientError) -> bool:
    return error.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException"
