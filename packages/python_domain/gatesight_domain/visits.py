"""Pure visit-pairing decisions used by the EventBridge projector."""

from __future__ import annotations

from datetime import datetime

from gatesight_domain.models import Direction, VisitOutcome


def project_visit(
    *,
    direction: Direction,
    observed_at: datetime,
    open_visit_started_at: datetime | None,
    duplicate: bool,
) -> VisitOutcome:
    if duplicate:
        return VisitOutcome(action="DUPLICATE_SUPPRESSED")
    if direction is Direction.ENTRY:
        if open_visit_started_at is not None:
            return VisitOutcome(action="ANOMALY", anomaly="REPEATED_ENTRY")
        return VisitOutcome(action="OPENED")
    if open_visit_started_at is None:
        return VisitOutcome(action="ANOMALY", anomaly="ORPHAN_EXIT")
    return VisitOutcome(
        action="CLOSED",
        dwell_seconds=max(0, int((observed_at - open_visit_started_at).total_seconds())),
    )
