# ADR-013: No alert from uncertain recognition

## Context

A false “unregistered vehicle” alert wastes security attention and can cause an unjustified operational response. Absence of a confident reading is not evidence of absence from an allowlist.

## Decision

Only `RECOGNIZED`, high-confidence, `ENTRY` observations enter registration evaluation. Review/no-plate/multiple/failed/low-confidence outcomes cannot create an unregistered alert. Active registrations suppress; blocked matches alert.

## Alternatives considered

Alerting on best-effort OCR or failed registration lookup increases apparent coverage but violates evidence quality. Alerting every review item overwhelms security; review remains a separate queue.

## Consequences

Some genuinely unregistered vehicles produce review/no alert. This is an intentional precision-first guardrail. Metrics must track review coverage and reviewed false negatives.

## Revisit when

Only the calibrated confidence threshold or review workflow may change. The invariant that uncertain OCR is not “unregistered” requires an explicit safety/business approval and new ADR.
