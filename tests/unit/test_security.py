from gatesight_domain.models import Direction, ObservationState, RegistrationStatus
from gatesight_domain.security import evaluate_alert


def decide(
    *,
    direction: Direction = Direction.ENTRY,
    state: ObservationState = ObservationState.RECOGNIZED,
    score: float = 0.95,
    registration: RegistrationStatus | None = None,
) -> bool:
    return evaluate_alert(
        direction=direction,
        state=state,
        consensus_score=score,
        high_confidence_threshold=0.88,
        registration_status=registration,
    ).create_alert


def test_registered_entry_does_not_alert() -> None:
    assert not decide(registration=RegistrationStatus.ACTIVE)


def test_unregistered_entry_alerts() -> None:
    assert decide()


def test_blocked_vehicle_entry_alerts() -> None:
    assert decide(registration=RegistrationStatus.BLOCKED)


def test_unregistered_exit_does_not_alert() -> None:
    assert not decide(direction=Direction.EXIT)


def test_uncertain_states_never_alert() -> None:
    for state in (
        ObservationState.NEEDS_REVIEW,
        ObservationState.NO_PLATE,
        ObservationState.MULTIPLE_PLATES,
        ObservationState.FAILED,
    ):
        assert not decide(state=state)


def test_below_high_confidence_never_alerts() -> None:
    assert not decide(score=0.879)
