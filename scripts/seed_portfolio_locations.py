"""Idempotently seed portfolio facilities and logical camera gates."""

from __future__ import annotations

import argparse
import os
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any

import boto3
from botocore.exceptions import ClientError

LOCATIONS = (
    ("fac_atlanta", "Atlanta", "America/New_York", "atlanta"),
    ("fac_dallas", "Dallas", "America/Chicago", "dallas"),
    ("fac_san_diego", "San Diego", "America/Los_Angeles", "san_diego"),
)


def records(tenant_id: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    created = datetime.now(UTC)
    facilities: list[dict[str, Any]] = []
    stations: list[dict[str, Any]] = []
    for location_index, (facility_id, name, timezone, slug) in enumerate(LOCATIONS):
        facility_created = created + timedelta(milliseconds=location_index * 10)
        facilities.append(
            {
                "tenantId": tenant_id,
                "recordId": facility_id,
                "name": name,
                "timezone": timezone,
                "createdAt": facility_created.isoformat(),
            }
        )
        for gate_index, (direction, gate_name) in enumerate(
            (("ENTRY", "Main Entry Gate"), ("EXIT", "Main Exit Gate")),
        ):
            stations.append(
                {
                    "tenantId": tenant_id,
                    "recordId": f"sta_{slug}_{direction.lower()}",
                    "facilityId": facility_id,
                    "name": gate_name,
                    "direction": direction,
                    "motion_sensitivity": Decimal("0.12"),
                    "cooldown_seconds": 15,
                    "createdAt": (
                        facility_created + timedelta(milliseconds=gate_index + 1)
                    ).isoformat(),
                }
            )
    return facilities, stations


def put_if_missing(table: Any, item: dict[str, Any]) -> str:
    try:
        table.put_item(
            Item=item,
            ConditionExpression="attribute_not_exists(recordId)",
        )
        return "created"
    except ClientError as error:
        if error.response.get("Error", {}).get("Code") != "ConditionalCheckFailedException":
            raise
        existing = table.get_item(
            Key={"tenantId": item["tenantId"], "recordId": item["recordId"]},
            ConsistentRead=True,
        ).get("Item")
        expected = {key: value for key, value in item.items() if key != "createdAt"}
        actual = (
            {key: value for key, value in existing.items() if key != "createdAt"}
            if existing
            else None
        )
        if actual != expected:
            raise RuntimeError(
                f"{table.name}/{item['recordId']} exists with different values",
            ) from error
        return "unchanged"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Write records. Without this flag, print the planned records only.",
    )
    parser.add_argument(
        "--region",
        default=os.getenv("AWS_REGION", "us-east-1"),
    )
    parser.add_argument(
        "--table-prefix",
        default=os.getenv("GATESIGHT_TABLE_PREFIX", "gatesight-dev"),
    )
    parser.add_argument(
        "--tenant-id",
        default=os.getenv("GATESIGHT_TENANT_ID", "tenant_portfolio"),
    )
    args = parser.parse_args()

    facilities, stations = records(args.tenant_id)
    if not args.apply:
        for item in (*facilities, *stations):
            print(f"plan {item['recordId']}: {item['name']}")
        return

    dynamodb = boto3.resource("dynamodb", region_name=args.region)
    facility_table = dynamodb.Table(f"{args.table_prefix}-facilities")
    station_table = dynamodb.Table(f"{args.table_prefix}-stations")
    for table, items in (
        (facility_table, facilities),
        (station_table, stations),
    ):
        for item in items:
            result = put_if_missing(table, item)
            print(f"{result} {table.name}/{item['recordId']}")


if __name__ == "__main__":
    main()
