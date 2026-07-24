"""AWS persistence for recognition with a transactional outbox."""

from __future__ import annotations

import math
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

import boto3
from boto3.dynamodb.types import TypeSerializer
from botocore.exceptions import ClientError
from gatesight_domain.models import ConsensusResult, DomainEvent, RecognitionJob

_serializer = TypeSerializer()


def _dynamodb_compatible(value: Any) -> Any:
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError("DynamoDB values must be finite")
        return Decimal(str(value))
    if isinstance(value, list):
        return [_dynamodb_compatible(item) for item in value]
    if isinstance(value, dict):
        return {key: _dynamodb_compatible(item) for key, item in value.items()}
    return value


def serialize(item: dict[str, Any]) -> dict[str, Any]:
    return {key: _serializer.serialize(_dynamodb_compatible(value)) for key, value in item.items()}


class RecognitionRepository:
    def __init__(self, *, region: str, table_prefix: str) -> None:
        session = boto3.session.Session(region_name=region)
        self.s3 = session.client("s3")
        self.dynamodb = session.resource("dynamodb")
        self.dynamodb_client = session.client("dynamodb")
        self.table_prefix = table_prefix

    def get_bytes(self, bucket: str, key: str, maximum_bytes: int) -> bytes:
        response = self.s3.get_object(Bucket=bucket, Key=key)
        content_length = int(response.get("ContentLength", 0))
        content_type = response.get("ContentType")
        if content_type != "image/jpeg":
            raise ValueError("S3 object is not an image/jpeg")
        if content_length <= 0 or content_length > maximum_bytes:
            raise ValueError("S3 object size is outside the accepted range")
        payload = response["Body"].read(maximum_bytes + 1)
        if len(payload) != content_length or len(payload) > maximum_bytes:
            raise ValueError("S3 object body length is invalid")
        return payload

    def put_derived_crop(
        self,
        *,
        bucket: str,
        key: str,
        body: bytes,
        capture_id: str,
        variant: str,
    ) -> None:
        self.s3.put_object(
            Bucket=bucket,
            Key=key,
            Body=body,
            ContentType="image/jpeg",
            ServerSideEncryption="aws:kms",
            Metadata={"capture-id": capture_id, "variant": variant},
        )

    def claim(self, job: RecognitionJob, started_at: datetime) -> bool:
        table = self.dynamodb.Table(f"{self.table_prefix}-captures")
        try:
            table.update_item(
                Key={"tenantId": job.tenant_id, "recordId": job.capture_id},
                UpdateExpression=(
                    "SET #status=:processing, processingStartedAt=:started, "
                    "facilityStatus=:facility_status"
                ),
                ConditionExpression="#status=:queued",
                ExpressionAttributeNames={"#status": "status"},
                ExpressionAttributeValues={
                    ":processing": "PROCESSING",
                    ":queued": "QUEUED",
                    ":started": started_at.isoformat(),
                    ":facility_status": f"{job.facility_id}#PROCESSING",
                },
            )
            return True
        except ClientError as error:
            if error.response.get("Error", {}).get("Code") != "ConditionalCheckFailedException":
                raise
            return False

    def observation_exists(self, tenant_id: str, observation_id: str) -> bool:
        response = self.dynamodb.Table(f"{self.table_prefix}-observations").get_item(
            Key={"tenantId": tenant_id, "recordId": observation_id},
            ConsistentRead=True,
            ProjectionExpression="recordId",
        )
        return "Item" in response

    def complete(
        self,
        *,
        job: RecognitionJob,
        observation_id: str,
        outbox_id: str,
        consensus: ConsensusResult,
        event: DomainEvent,
        started_at: datetime,
        completed_at: datetime,
        derived_crop_keys: list[str],
        model_version: str,
    ) -> None:
        observation = {
            "tenantId": job.tenant_id,
            "recordId": observation_id,
            "captureId": job.capture_id,
            "facilityId": job.facility_id,
            "stationId": job.station_id,
            "direction": job.direction.value,
            "state": consensus.state.value,
            "normalizedPlate": consensus.normalized_text,
            "consensusScore": str(consensus.consensus_score),
            "decisionReason": consensus.reason,
            "rawCandidates": [
                candidate.model_dump(mode="json") for candidate in consensus.candidates
            ],
            "modelVersion": model_version,
            "capturedAt": job.estimated_captured_at_server.isoformat(),
            "createdAt": completed_at.isoformat(),
            "processingStartedAt": started_at.isoformat(),
            "processingCompletedAt": completed_at.isoformat(),
            "processingDurationMs": int((completed_at - started_at).total_seconds() * 1000),
            "facilityTimezone": job.facility_timezone,
            "mediaAvailable": True,
            "derivedCropKeys": derived_crop_keys,
            "reviewDecision": "PENDING",
        }
        outbox = {
            "tenantId": job.tenant_id,
            "recordId": outbox_id,
            "status": "PENDING",
            "eventType": event.type,
            "event": event.model_dump(mode="json", by_alias=True),
            "createdAt": completed_at.isoformat(),
            "publishAttempts": 0,
        }
        self.dynamodb_client.transact_write_items(
            TransactItems=[
                {
                    "Put": {
                        "TableName": f"{self.table_prefix}-observations",
                        "Item": serialize(observation),
                        "ConditionExpression": "attribute_not_exists(recordId)",
                    }
                },
                {
                    "Update": {
                        "TableName": f"{self.table_prefix}-captures",
                        "Key": serialize({"tenantId": job.tenant_id, "recordId": job.capture_id}),
                        "UpdateExpression": (
                            "SET #status=:status, observationId=:observation, "
                            "processingCompletedAt=:completed, facilityStatus=:facility_status"
                        ),
                        "ConditionExpression": "#status=:processing",
                        "ExpressionAttributeNames": {"#status": "status"},
                        "ExpressionAttributeValues": serialize(
                            {
                                ":status": consensus.state.value,
                                ":processing": "PROCESSING",
                                ":observation": observation_id,
                                ":completed": completed_at.isoformat(),
                                ":facility_status": f"{job.facility_id}#{consensus.state.value}",
                            }
                        ),
                    }
                },
                {
                    "Put": {
                        "TableName": f"{self.table_prefix}-outbox",
                        "Item": serialize(outbox),
                        "ConditionExpression": "attribute_not_exists(recordId)",
                    }
                },
            ],
            ClientRequestToken=job.capture_id[:36],
        )

    def fail(self, job: RecognitionJob, reason: str) -> None:
        safe_reason = reason[:240].replace(job.capture_id, "[capture]")
        self.dynamodb.Table(f"{self.table_prefix}-captures").update_item(
            Key={"tenantId": job.tenant_id, "recordId": job.capture_id},
            UpdateExpression=(
                "SET #status=:failed, failureCode=:reason, processingCompletedAt=:completed, "
                "facilityStatus=:facility_status"
            ),
            ExpressionAttributeNames={"#status": "status"},
            ExpressionAttributeValues={
                ":failed": "FAILED",
                ":reason": safe_reason,
                ":completed": datetime.now(UTC).isoformat(),
                ":facility_status": f"{job.facility_id}#FAILED",
            },
        )
