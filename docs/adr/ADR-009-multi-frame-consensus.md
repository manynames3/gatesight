# ADR-009: Confidence-weighted multi-frame consensus

## Context

One frame may be blurred, glared, angled, obstructed, or misread. Treating a single OCR string as fact creates false alerts.

## Decision

Capture 3–5 frames; prefer exact agreement across at least two good frames; weight detector/OCR/character/quality evidence; penalize conflict; preserve every candidate; route ambiguity to review.

## Alternatives considered

Best-single-frame selection is simpler but fragile. Majority vote ignores confidence/quality. Regional regex correction can invent evidence and is forbidden.

## Consequences

More S3/inference work buys review evidence and robustness. Thresholds require labeled calibration and remain SSM configuration.

## Revisit when

Facility-specific evaluation supports a simpler/equally safe policy or temporal video tracking provides demonstrably better evidence.
