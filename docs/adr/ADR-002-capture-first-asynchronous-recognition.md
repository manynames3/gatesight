# ADR-002: Capture-first asynchronous recognition

## Context

Synchronous OCR makes the gate’s immediate capture depend on network latency, model initialization, and Lambda cold starts.

## Decision

Capture the full burst first, upload it, explicitly complete the session, then queue recognition. Poll status with exponential backoff.

## Alternatives considered

Synchronous API inference is simpler but fragile in the lane. Browser inference increases download/compute/privacy variability. A permanent inference service adds idle cost.

## Consequences

Capture is responsive and bursts buffer safely. Results are eventually consistent and the UI needs queued/processing states, timeout guidance, and review.

## Revisit when

A measured operational workflow requires subsecond recognition and justified provisioned/edge inference can meet privacy, licensing, and cost requirements.
