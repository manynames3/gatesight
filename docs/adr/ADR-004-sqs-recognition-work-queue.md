# ADR-004: SQS as the recognition work queue

## Context

Recognition is discrete, CPU-compatible, retryable work with bursty arrivals and a need for queue depth, age, backpressure, and DLQ operations.

## Decision

Use encrypted SQS Standard with batch size 1, visibility longer than worker timeout, bounded receives, and a DLQ.

## Alternatives considered

EventBridge is routing rather than worker backpressure. Kinesis is optimized for ordered streams/shards. Direct invocation lacks durable buffering. Step Functions adds orchestration without another stage.

## Consequences

Delivery is at least once and not ordered. Deterministic IDs, capture transitions, and worker idempotency are required.

## Revisit when

The workflow gains genuine multi-stage orchestration, strict per-key ordering cannot be handled in state, or sustained workload favors another compute model.
