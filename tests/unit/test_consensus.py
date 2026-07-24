from __future__ import annotations

from gatesight_domain.consensus import ConsensusThresholds, decide_consensus, levenshtein
from gatesight_domain.models import FrameQuality, ObservationState, PlateCandidate


def candidate(
    text: str,
    frame: int,
    *,
    detector: float = 0.99,
    ocr: float = 0.99,
    usable: bool = True,
    pixels: int = 180,
    source: str = "DETECTOR",
) -> PlateCandidate:
    return PlateCandidate(
        frame_index=frame,
        raw_text=text,
        normalized_text=text or None,
        detector_confidence=detector,
        ocr_confidence=ocr,
        character_confidences=[ocr] * len(text),
        quality=FrameQuality(
            blur_score=300,
            exposure_score=0.95,
            glare_score=0.01,
            perspective_score=0.95,
            plate_pixel_width=pixels,
            usable=usable,
        ),
        bounding_box=(10, 10, 10 + pixels, 80),
        source=source,
    )


def test_exact_agreement_across_good_frames_is_recognized() -> None:
    result = decide_consensus([candidate("ABC123", 0), candidate("ABC123", 1)])
    assert result.state is ObservationState.RECOGNIZED
    assert result.normalized_text == "ABC123"


def test_plate_in_only_one_frame_needs_review() -> None:
    result = decide_consensus([candidate("ABC123", 0)])
    assert result.state is ObservationState.NEEDS_REVIEW


def test_conflicting_high_confidence_readings_need_review() -> None:
    result = decide_consensus(
        [
            candidate("ABC123", 0),
            candidate("ABC123", 1),
            candidate("XYZ789", 2),
        ]
    )
    assert result.state is ObservationState.NEEDS_REVIEW
    assert "conflicting" in result.reason


def test_low_confidence_ocr_needs_review() -> None:
    result = decide_consensus([candidate("ABC123", 0, ocr=0.3), candidate("ABC123", 1, ocr=0.3)])
    assert result.state is ObservationState.NEEDS_REVIEW


def test_four_unanimous_strong_readings_override_a_conservative_composite_score() -> None:
    result = decide_consensus(
        [
            candidate("ABC123", 0, detector=0.8061, ocr=0.9998, pixels=657),
            candidate("ABC123", 1, detector=0.5692, ocr=0.9998, pixels=643),
            candidate("ABC123", 2, detector=0.8439, ocr=0.9999, pixels=655),
            candidate("ABC123", 3, detector=0.8123, ocr=0.9999, pixels=666),
        ]
    )

    assert result.consensus_score < ConsensusThresholds().high_confidence
    assert result.state is ObservationState.RECOGNIZED
    assert result.reason == "unanimous high-confidence agreement across all frames"


def test_unanimous_override_rejects_weak_detector_evidence() -> None:
    result = decide_consensus(
        [
            candidate("ABC123", 0, detector=0.80, ocr=0.99),
            candidate("ABC123", 1, detector=0.54, ocr=0.99),
            candidate("ABC123", 2, detector=0.81, ocr=0.99),
            candidate("ABC123", 3, detector=0.82, ocr=0.99),
        ]
    )

    assert result.state is ObservationState.NEEDS_REVIEW


def test_unanimous_guide_fallback_can_recognize_without_detector_evidence() -> None:
    result = decide_consensus(
        [
            candidate("ABC123", frame, detector=0, ocr=0.995, source="GUIDE_FALLBACK")
            for frame in range(4)
        ]
    )

    assert result.state is ObservationState.RECOGNIZED
    assert result.normalized_text == "ABC123"


def test_guide_fallback_below_unanimous_ocr_threshold_needs_review() -> None:
    result = decide_consensus(
        [
            candidate("ABC123", frame, detector=0, ocr=0.97, source="GUIDE_FALLBACK")
            for frame in range(4)
        ]
    )

    assert result.state is ObservationState.NEEDS_REVIEW


def test_guide_fallback_never_uses_the_regular_score_threshold() -> None:
    result = decide_consensus(
        [
            candidate("ABC123", frame, detector=0, ocr=0.995, source="GUIDE_FALLBACK")
            for frame in range(2)
        ],
        ConsensusThresholds(high_confidence=0.5),
    )

    assert result.state is ObservationState.NEEDS_REVIEW


def test_unanimous_override_requires_distinct_frames() -> None:
    result = decide_consensus(
        [
            candidate("ABC123", 0, detector=0.80, ocr=0.99),
            candidate("ABC123", 1, detector=0.56, ocr=0.99),
            candidate("ABC123", 2, detector=0.81, ocr=0.99),
            candidate("ABC123", 2, detector=0.82, ocr=0.99),
        ]
    )

    assert result.state is ObservationState.NEEDS_REVIEW


def test_multiple_plates_are_ambiguous() -> None:
    result = decide_consensus([candidate("ABC123", 0)], ambiguous_plate_count=2)
    assert result.state is ObservationState.MULTIPLE_PLATES


def test_no_candidates_needs_review_instead_of_claiming_no_plate() -> None:
    result = decide_consensus([])
    assert result.state is ObservationState.NEEDS_REVIEW
    assert "manual review" in result.reason


def test_bad_quality_and_small_plate_needs_review() -> None:
    result = decide_consensus(
        [candidate("ABC123", 0, usable=False), candidate("ABC123", 1, pixels=20)]
    )
    assert result.state is ObservationState.NEEDS_REVIEW


def test_edit_distance() -> None:
    assert levenshtein("ABC123", "ABC128") == 1
    assert levenshtein("ABC123", "XYZ789") == 6


def test_thresholds_are_configurable() -> None:
    result = decide_consensus(
        [candidate("ABC123", 0)],
        ConsensusThresholds(high_confidence=0.5, minimum_good_frames=1),
    )
    assert result.state is ObservationState.RECOGNIZED
