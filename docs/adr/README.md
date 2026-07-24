# Architecture decisions

These records explain the important choices behind GateSight.

Start with the decision you are questioning. Each record gives you the context,
the chosen approach, the tradeoffs, and the condition that would justify
revisiting it.

| Decision | Why it matters |
| --- | --- |
| [ADR-001: Browser-only capture](ADR-001-browser-only-capture.md) | Keeps capture hardware simple and avoids a native edge agent |
| [ADR-002: Capture-first processing](ADR-002-capture-first-asynchronous-recognition.md) | Keeps recognition latency from blocking the gate |
| [ADR-003: Direct S3 uploads](ADR-003-direct-presigned-s3-uploads.md) | Moves image bytes without routing them through the API |
| [ADR-004: SQS recognition queue](ADR-004-sqs-recognition-work-queue.md) | Adds retries, backpressure, and a dead-letter path |
| [ADR-005: EventBridge after recognition](ADR-005-eventbridge-after-recognition.md) | Separates recognition from visits and alerts |
| [ADR-006: Lambda instead of ECS](ADR-006-lambda-instead-of-ecs.md) | Matches bursty portfolio traffic without an always-on service |
| [ADR-007: FastALPR and FastPlateOCR](ADR-007-fastalpr-fastplateocr.md) | Defines the current recognition stack and its release gate |
| [ADR-008: DynamoDB access patterns](ADR-008-dynamodb-access-pattern-design.md) | Keeps queries explicit and avoids routine scans |
| [ADR-009: Multi-frame consensus](ADR-009-multi-frame-consensus.md) | Reduces the risk of treating one weak OCR result as fact |
| [ADR-010: No local media persistence](ADR-010-no-local-media-persistence.md) | Limits browser-side retention of sensitive media |
| [ADR-011: Transactional outbox](ADR-011-transactional-outbox.md) | Prevents committed recognition from losing its domain event |
| [ADR-012: Standard queue and idempotency](ADR-012-standard-queue-idempotency.md) | Handles duplicates without paying for FIFO ordering |
| [ADR-013: No alert from uncertainty](ADR-013-no-alert-from-uncertainty.md) | Prevents uncertain OCR from becoming a security claim |
