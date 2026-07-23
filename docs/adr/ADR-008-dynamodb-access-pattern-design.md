# ADR-008: DynamoDB access-pattern design

## Context

GateSight needs tenant-scoped point reads, facility/time lists, plate authorization, open visits, idempotency TTL, transactions, and an outbox stream.

## Decision

Use separate on-demand tables with a consistent tenant/record key, explicit GSIs, KMS, production PITR/deletion protection, and no routine scans.

## Alternatives considered

A single table can reduce table count and support mixed entities, but makes independent retention/streams/policies harder to reason about here. RDS adds always-running or connection-management cost without a relational requirement.

## Consequences

Some data is denormalized into index keys and consumers must understand eventual GSI consistency. Transactions protect state boundaries.

## Revisit when

Measured access patterns show unacceptable transaction/table overhead or new cross-entity queries materially benefit from a reviewed single-table design.
