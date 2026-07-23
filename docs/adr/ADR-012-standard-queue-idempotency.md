# ADR-012: Standard queue plus idempotency instead of FIFO

## Context

Recognition jobs are independent captures. Business ordering derives from timestamps and state, while duplicates are already unavoidable downstream.

## Decision

Use SQS Standard. Handle order through server-adjusted capture time, conditional transitions, deterministic identifiers, and idempotent consumers.

## Alternatives considered

FIFO adds group/deduplication semantics and throughput constraints but cannot remove every duplicate/failure boundary or solve delayed browser completion.

## Consequences

Code must treat duplicate/out-of-order delivery as normal. The queue can scale without selecting a potentially hot message-group key.

## Revisit when

A documented invariant requires strict serialization per station/plate and cannot be enforced safely with DynamoDB state.
