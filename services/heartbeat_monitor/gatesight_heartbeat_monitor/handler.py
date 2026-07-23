"""Emit a bounded operational metric for stale camera stations."""

from __future__ import annotations

import os
from datetime import UTC, datetime, timedelta
from typing import Any

import boto3
from aws_lambda_powertools import Logger, Metrics, Tracer
from aws_lambda_powertools.metrics import MetricUnit

logger = Logger(service="heartbeat-monitor")
tracer = Tracer(service="heartbeat-monitor")
metrics = Metrics(namespace="GateSight", service="heartbeat-monitor")

REGION = os.getenv("AWS_REGION", "us-east-1")
TABLE_PREFIX = os.getenv("GATESIGHT_TABLE_PREFIX", "gatesight-local")
STALE_AFTER_SECONDS = int(os.getenv("GATESIGHT_STALE_HEARTBEAT_SECONDS", "180"))


def is_stale(station: dict[str, Any], cutoff: datetime) -> bool:
    raw = station.get("lastHeartbeatAt") or station.get("createdAt")
    if not isinstance(raw, str):
        return True
    try:
        observed = datetime.fromisoformat(raw)
    except ValueError:
        return True
    if observed.tzinfo is None:
        observed = observed.replace(tzinfo=UTC)
    return observed < cutoff


def _stale_station_count() -> tuple[int, int]:
    table = boto3.resource("dynamodb", region_name=REGION).Table(f"{TABLE_PREFIX}-stations")
    cutoff = datetime.now(UTC) - timedelta(seconds=STALE_AFTER_SECONDS)
    stale = 0
    scanned = 0
    exclusive_start_key: dict[str, Any] | None = None
    while True:
        arguments: dict[str, Any] = {
            "ProjectionExpression": "tenantId, recordId, createdAt, lastHeartbeatAt"
        }
        if exclusive_start_key:
            arguments["ExclusiveStartKey"] = exclusive_start_key
        response = table.scan(**arguments)
        items = response.get("Items", [])
        scanned += len(items)
        stale += sum(1 for station in items if is_stale(station, cutoff))
        exclusive_start_key = response.get("LastEvaluatedKey")
        if not exclusive_start_key:
            break
    return stale, scanned


@logger.inject_lambda_context(clear_state=True, log_event=False)
@tracer.capture_lambda_handler
@metrics.log_metrics(capture_cold_start_metric=True)
def handler(event: dict[str, Any], context: Any) -> None:
    del event, context
    stale, scanned = _stale_station_count()
    metrics.add_metric(
        name="StaleCameraStations",
        unit=MetricUnit.Count,
        value=stale,
    )
    metrics.add_metric(
        name="CameraStationsEvaluated",
        unit=MetricUnit.Count,
        value=scanned,
    )
    logger.info(
        "camera station heartbeat evaluation completed",
        extra={"station_count": scanned, "stale_station_count": stale},
    )
