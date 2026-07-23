# ADR-005: EventBridge after recognition

## Context

Completed recognition drives independent visit and security behaviors and may gain more consumers.

## Decision

Publish one versioned domain event to a custom EventBridge bus only after transactional persistence through the outbox.

## Alternatives considered

Directly invoking consumers couples availability/deployment. SNS fan-out offers less rule/filter evolution. SQS per consumer requires producer queue knowledge. EventBridge before recognition lacks queue semantics needed by CPU work.

## Consequences

Consumers evolve independently and must be idempotent under duplicate/delayed delivery. Contracts require versioning and compatibility review.

## Revisit when

Only one consumer remains permanently, ordering semantics change, or cross-account/event archival requirements favor a different topology.
