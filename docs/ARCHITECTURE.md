# Architecture

Use this guide when you need to understand where data moves, which component owns each decision, or why the system behaves asynchronously.

## At a glance

GateSight has one time-sensitive job: capture the vehicle while it is in position.

Everything after capture is durable and retryable:

1. The browser captures five candidates and uploads the strongest four.
2. The control API verifies the upload and queues one recognition job.
3. The worker saves the observation and event intent atomically.
4. Independent consumers project visits and evaluate security policy.

## Design objective

Separate the time-critical act of photographing a vehicle from CPU-heavy recognition. The browser captures first, SQS controls the work, and versioned domain events fan out only after the observation is safely stored.

## Trust boundaries

1. **Browser / Cloudflare Pages** — untrusted client input. OAuth state and tokens use session storage; media stays in process memory.
2. **Cognito and API Gateway** — Hosted UI identity, PKCE, JWT signature/audience/issuer validation.
3. **Control API** — role, tenant, facility, state, payload, idempotency, and object-key enforcement.
4. **Private data plane** — S3, SQS, DynamoDB, KMS, EventBridge, and Lambda under service-specific roles.
5. **Operations** — GitHub OIDC deployment roles, CloudWatch, security notification topic, and human review.

The rule is simple: never trust a client-supplied identifier as authorization evidence. The backend derives tenant membership from verified claims and checks every facility/object relationship.

## Components

| Component | Responsibility | Scaling/failure boundary |
| --- | --- | --- |
| React station | Camera lifecycle, burst, memory-only queue, direct upload, polling | Browser/tab/device |
| Control API | Sessions, presign, completion, status, domain/admin APIs | ZIP Lambda |
| S3 | Encrypted capture and derived evidence retention | Regional service |
| SQS Standard | Recognition buffer, retry, DLQ, backpressure | At-least-once |
| Recognition worker | Decode, quality, FastALPR, consensus, transaction | Container Lambda, batch 1 |
| DynamoDB | Domain state, conditions, transactions, TTL, outbox stream | On-demand tables |
| Outbox publisher | Publish committed event intent | Stream Lambda |
| EventBridge | Independent business routing | At-least-once |
| Visit projector | Pair entry/exit and record anomalies | Idempotent Lambda |
| Security evaluator | Allowlist/blocked lookup and alert suppression | Idempotent Lambda |

## State transitions

Capture transitions are conditional:

```text
CREATED → UPLOADING → QUEUED → PROCESSING
                                  ├→ RECOGNIZED
                                  ├→ NEEDS_REVIEW
                                  ├→ MULTIPLE_PLATES
                                  └→ FAILED
```

The worker uses `NEEDS_REVIEW` when the detector returns no candidates rather than asserting that no plate was present. `NO_PLATE` remains in the versioned contract only for backward compatibility with existing records.

The capture job carries normalized guide coordinates. The worker searches a
padded guide crop first, then the full frame. Only unanimous, exceptionally
strong four-frame OCR evidence can recover a plate when both detector passes
miss.

The worker uses a deterministic observation/outbox ID derived from the capture ID. A duplicate delivery either claims `QUEUED → PROCESSING`, sees the committed observation, or fails for retry; it cannot create another observation.

## Availability and consistency

- SQS and EventBridge are at-least-once; duplicate delivery is expected.
- Standard queue order is not trusted.
- `estimatedCapturedAtServer` orders domain activity.
- GSI reads may be eventually consistent; correctness boundaries use primary-key reads and transactions.
- Outbox publication can duplicate after publish-before-status failure. Consumer markers make the duplicate harmless.
- Capture completion is explicit because a multi-frame burst cannot be inferred from individual S3 object events.

## Deployment topology

AWS resources are regional and configurable from `us-east-1`. No VPC is created because every dependency is an AWS public service endpoint and no private network requirement exists. Introducing a VPC requires an ADR and cost review; it would otherwise introduce NAT or endpoint cost/complexity.

Cloudflare Pages hosts static assets. API/S3/Cognito origins appear in CORS and generated CSP. Production and preview domains are separate configured origins.
