# ADR-011: Transactional outbox

## Context

Writing an observation and separately publishing an event can leave persisted state without event intent or an event without state.

## Decision

Write observation, capture terminal state, and `PENDING` outbox in one DynamoDB transaction. Publish from the outbox stream and conditionally mark published.

## Alternatives considered

Direct EventBridge publish after write has a dual-write gap. EventBridge before persistence exposes missing details. DynamoDB Streams directly from observations couples storage shape to public contract.

## Consequences

Intent cannot diverge from observation persistence. Publish-before-status failure can duplicate; consumers are idempotent. Iterator age is an operational signal.

## Revisit when

A platform-provided atomic event store replaces DynamoDB or domain volume demands a dedicated outbox partitioning strategy.
