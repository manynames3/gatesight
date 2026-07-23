from datetime import UTC, datetime, timedelta

from gatesight_domain.models import Direction
from gatesight_domain.visits import project_visit

NOW = datetime(2026, 7, 23, 12, tzinfo=UTC)


def test_entry_opens_visit() -> None:
    assert (
        project_visit(
            direction=Direction.ENTRY,
            observed_at=NOW,
            open_visit_started_at=None,
            duplicate=False,
        ).action
        == "OPENED"
    )


def test_exit_closes_most_recent_open_visit() -> None:
    result = project_visit(
        direction=Direction.EXIT,
        observed_at=NOW,
        open_visit_started_at=NOW - timedelta(minutes=12),
        duplicate=False,
    )
    assert result.action == "CLOSED"
    assert result.dwell_seconds == 720


def test_orphan_exit_is_anomaly() -> None:
    result = project_visit(
        direction=Direction.EXIT,
        observed_at=NOW,
        open_visit_started_at=None,
        duplicate=False,
    )
    assert result.anomaly == "ORPHAN_EXIT"


def test_repeated_entry_is_anomaly() -> None:
    result = project_visit(
        direction=Direction.ENTRY,
        observed_at=NOW,
        open_visit_started_at=NOW - timedelta(minutes=1),
        duplicate=False,
    )
    assert result.anomaly == "REPEATED_ENTRY"


def test_duplicate_entry_is_suppressed_without_deleting_observation() -> None:
    result = project_visit(
        direction=Direction.ENTRY,
        observed_at=NOW,
        open_visit_started_at=NOW,
        duplicate=True,
    )
    assert result.action == "DUPLICATE_SUPPRESSED"


def test_delayed_exit_never_produces_negative_dwell() -> None:
    result = project_visit(
        direction=Direction.EXIT,
        observed_at=NOW - timedelta(minutes=5),
        open_visit_started_at=NOW,
        duplicate=False,
    )
    assert result.dwell_seconds == 0
