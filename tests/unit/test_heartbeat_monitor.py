from datetime import UTC, datetime, timedelta

from gatesight_heartbeat_monitor.handler import is_stale


def test_station_heartbeat_staleness() -> None:
    now = datetime.now(UTC)
    assert is_stale(
        {
            "commissioned": True,
            "lastHeartbeatAt": (now - timedelta(minutes=10)).isoformat(),
        },
        now,
    )
    assert not is_stale(
        {
            "commissioned": True,
            "lastHeartbeatAt": (now + timedelta(seconds=1)).isoformat(),
        },
        now,
    )


def test_missing_or_invalid_heartbeat_is_stale() -> None:
    cutoff = datetime.now(UTC)
    assert not is_stale({}, cutoff)
    assert is_stale({"commissioned": True}, cutoff)
    assert is_stale(
        {"commissioned": True, "createdAt": "not-a-timestamp"},
        cutoff,
    )
