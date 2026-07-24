"""Confidence-weighted, multi-frame consensus policy."""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass

from gatesight_domain.models import ConsensusResult, ObservationState, PlateCandidate


@dataclass(frozen=True, slots=True)
class ConsensusThresholds:
    high_confidence: float = 0.88
    review_confidence: float = 0.55
    minimum_good_frames: int = 2
    maximum_edit_distance: int = 1
    minimum_plate_pixels: int = 72
    unanimous_frames: int = 4
    unanimous_ocr_confidence: float = 0.95
    unanimous_detector_confidence: float = 0.55
    unanimous_guide_ocr_confidence: float = 0.98


def levenshtein(left: str, right: str) -> int:
    if len(left) < len(right):
        return levenshtein(right, left)
    previous = list(range(len(right) + 1))
    for left_index, left_char in enumerate(left, 1):
        current = [left_index]
        for right_index, right_char in enumerate(right, 1):
            current.append(
                min(
                    current[-1] + 1,
                    previous[right_index] + 1,
                    previous[right_index - 1] + (left_char != right_char),
                )
            )
        previous = current
    return previous[-1]


def _candidate_weight(candidate: PlateCandidate) -> float:
    quality = candidate.quality
    if not quality.usable or quality.plate_pixel_width < 1:
        return 0.0
    plate_size = min(1.0, quality.plate_pixel_width / 160)
    visual = (
        (min(quality.blur_score / 180, 1.0) * 0.3)
        + (quality.exposure_score * 0.25)
        + ((1 - quality.glare_score) * 0.2)
        + (quality.perspective_score * 0.15)
        + (plate_size * 0.1)
    )
    source_evidence = candidate.detector_confidence if candidate.source == "DETECTOR" else 0.65
    return source_evidence * candidate.ocr_confidence * visual


def decide_consensus(
    candidates: Iterable[PlateCandidate],
    thresholds: ConsensusThresholds | None = None,
    *,
    ambiguous_plate_count: int = 0,
) -> ConsensusResult:
    thresholds = thresholds or ConsensusThresholds()
    items = list(candidates)
    if ambiguous_plate_count > 1:
        return ConsensusResult(
            state=ObservationState.MULTIPLE_PLATES,
            consensus_score=0,
            reason="more than one plausible plate was detected",
            candidates=items,
            ambiguous_plate_count=ambiguous_plate_count,
        )
    usable = [
        candidate
        for candidate in items
        if candidate.normalized_text
        and candidate.quality.usable
        and candidate.quality.plate_pixel_width >= thresholds.minimum_plate_pixels
    ]
    if not items:
        return ConsensusResult(
            state=ObservationState.NEEDS_REVIEW,
            consensus_score=0,
            reason="the detector returned no candidates; manual review is required",
            candidates=[],
        )
    if not usable:
        return ConsensusResult(
            state=ObservationState.NEEDS_REVIEW,
            consensus_score=0,
            reason="detections were unsuitable for automatic acceptance",
            candidates=items,
        )

    grouped: dict[str, list[PlateCandidate]] = defaultdict(list)
    for candidate in usable:
        if candidate.normalized_text is not None:
            grouped[candidate.normalized_text].append(candidate)
    ranked = sorted(
        grouped.items(),
        key=lambda item: sum(_candidate_weight(candidate) for candidate in item[1]),
        reverse=True,
    )
    winner_text, winner = ranked[0]
    winner_weights = [_candidate_weight(candidate) for candidate in winner]
    agreement_bonus = min(0.1, 0.05 * (len(winner) - 1))
    score = min(1.0, (sum(winner_weights) / len(winner_weights)) + agreement_bonus)

    high_conflict = any(
        text != winner_text
        and levenshtein(text, winner_text) > thresholds.maximum_edit_distance
        and max(_candidate_weight(candidate) for candidate in group) >= thresholds.review_confidence
        for text, group in ranked[1:]
    )
    winner_frame_ids = {candidate.frame_index for candidate in winner}
    contains_guide_fallback = any(candidate.source == "GUIDE_FALLBACK" for candidate in winner)
    unanimous_high_confidence = (
        len(winner) >= thresholds.unanimous_frames
        and len(winner) == len(items)
        and len(winner_frame_ids) == len(winner)
        and all(
            candidate.ocr_confidence >= thresholds.unanimous_ocr_confidence for candidate in winner
        )
        and all(
            (
                candidate.source == "DETECTOR"
                and candidate.detector_confidence >= thresholds.unanimous_detector_confidence
            )
            or (
                candidate.source == "GUIDE_FALLBACK"
                and candidate.ocr_confidence >= thresholds.unanimous_guide_ocr_confidence
            )
            for candidate in winner
        )
    )
    if (
        len(winner) >= thresholds.minimum_good_frames
        and (
            (score >= thresholds.high_confidence and not contains_guide_fallback)
            or unanimous_high_confidence
        )
        and not high_conflict
    ):
        return ConsensusResult(
            state=ObservationState.RECOGNIZED,
            normalized_text=winner_text,
            consensus_score=score,
            reason=(
                "unanimous high-confidence agreement across all frames"
                if unanimous_high_confidence and score < thresholds.high_confidence
                else "exact agreement across good frames"
            ),
            candidates=items,
        )
    reason = "conflicting high-confidence readings" if high_conflict else "insufficient consensus"
    return ConsensusResult(
        state=ObservationState.NEEDS_REVIEW,
        consensus_score=score,
        reason=reason,
        candidates=items,
    )
