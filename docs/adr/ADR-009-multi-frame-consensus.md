# ADR-009: Confidence-weighted multi-frame consensus

## Context

One frame may be blurred, glared, angled, obstructed, or misread. Treating a single OCR string as fact creates false alerts.

## Decision

Capture five candidate frames and upload the strongest four. Require compatible
evidence across at least two usable frames, weight
detector/OCR/character/quality evidence, penalize conflict, and preserve every
uploaded candidate.

Strong unanimous agreement across all four frames may override a conservative
aggregate threshold. Conflicting or incomplete evidence always routes to
review.

## Alternatives considered

Best-single-frame selection is simpler but fragile. Majority vote ignores confidence/quality. Regional regex correction can invent evidence and is forbidden.

## Consequences

More S3 and inference work buys review evidence and robustness. Thresholds
require labeled calibration and remain SSM configuration. The unanimous
override must remain narrow and covered by regression tests.

## Revisit when

Facility-specific evaluation supports a simpler/equally safe policy or temporal video tracking provides demonstrably better evidence.
