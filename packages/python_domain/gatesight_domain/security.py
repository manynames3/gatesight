"""Alert eligibility policy with an explicit uncertainty barrier."""

from __future__ import annotations

from dataclasses import dataclass

from gatesight_domain.models import (
    Direction,
    ObservationState,
    RegistrationStatus,
)


@dataclass(frozen=True, slots=True)
class AlertDecision:
    create_alert: bool
    reason: str


def evaluate_alert(
    *,
    direction: Direction,
    state: ObservationState,
    consensus_score: float,
    high_confidence_threshold: float,
    registration_status: RegistrationStatus | None,
) -> AlertDecision:
    if direction is not Direction.ENTRY:
        return AlertDecision(False, "exit observations never create unregistered-entry alerts")
    if state is not ObservationState.RECOGNIZED:
        return AlertDecision(False, "uncertain observations require review")
    if consensus_score < high_confidence_threshold:
        return AlertDecision(False, "consensus is below the configured high-confidence threshold")
    if registration_status is RegistrationStatus.ACTIVE:
        return AlertDecision(False, "vehicle is actively authorized")
    if registration_status is RegistrationStatus.BLOCKED:
        return AlertDecision(True, "vehicle matches a blocked registration")
    return AlertDecision(True, "no active authorization matched")
