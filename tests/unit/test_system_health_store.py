from datetime import UTC, datetime
from unittest.mock import Mock

from gatesight_control_api.store import AwsStore


def test_queue_summary_reads_non_destructive_queue_counts() -> None:
    sqs = Mock()
    sqs.get_queue_attributes.return_value = {
        "Attributes": {
            "ApproximateNumberOfMessages": "2",
            "ApproximateNumberOfMessagesNotVisible": "1",
            "ApproximateNumberOfMessagesDelayed": "3",
        }
    }
    store = object.__new__(AwsStore)
    store.sqs = sqs

    assert store.queue_summary("https://sqs.example/queue") == {
        "configured": True,
        "visible": 2,
        "inFlight": 1,
        "delayed": 3,
    }


def test_outbox_summary_is_scoped_to_the_authenticated_tenant() -> None:
    table = Mock()
    table.query.return_value = {
        "Items": [
            {"status": "PUBLISHED", "createdAt": "2026-07-24T03:00:00+00:00"},
            {"status": "PENDING", "createdAt": "2026-07-24T03:02:00+00:00"},
            {"status": "PENDING", "createdAt": "2026-07-24T03:01:00+00:00"},
        ]
    }
    store = object.__new__(AwsStore)
    store.table = Mock(return_value=table)

    assert store.outbox_summary("tenant_portfolio") == {
        "pending": 2,
        "published": 1,
        "failed": 0,
        "total": 3,
        "oldestPendingAt": "2026-07-24T03:01:00+00:00",
    }
    condition = table.query.call_args.kwargs["KeyConditionExpression"]
    assert condition.get_expression()["values"][1] == "tenant_portfolio"


def test_station_heartbeat_summary_reports_fresh_and_stale_stations() -> None:
    table = Mock()
    table.query.return_value = {
        "Items": [
            {
                "recordId": "station_fresh",
                "facilityId": "fac_atlanta",
                "name": "Main Entry",
                "commissioned": True,
                "createdAt": "2026-07-24T03:00:00+00:00",
                "lastHeartbeatAt": "2026-07-24T03:21:00+00:00",
            },
            {
                "recordId": "station_stale",
                "facilityId": "fac_dallas",
                "name": "Main Exit",
                "commissioned": True,
                "createdAt": "2026-07-24T02:00:00+00:00",
            },
            {
                "recordId": "station_not_commissioned",
                "facilityId": "fac_san_diego",
                "name": "Overflow",
                "createdAt": "2026-07-24T01:00:00+00:00",
            },
        ]
    }
    store = object.__new__(AwsStore)
    store.table = Mock(return_value=table)

    result = store.station_heartbeat_summary(
        "tenant_portfolio",
        datetime(2026, 7, 24, 3, 22, tzinfo=UTC),
        180,
    )

    assert result["total"] == 2
    assert result["configured"] == 3
    assert result["uncommissioned"] == 1
    assert result["healthy"] == 1
    assert result["stale"] == 1
    assert result["stations"][0]["stationId"] == "station_fresh"
    assert result["stations"][1]["status"] == "stale"
    assert result["stations"][2]["status"] == "not_commissioned"
