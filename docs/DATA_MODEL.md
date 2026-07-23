# Data model and access patterns

## Review outcome

Separate tables keep authorization, retention, streams, and operational ownership explicit. A single-table design would reduce table count but would make mixed retention and the protected outbox stream harder to review without materially improving the current access patterns.

All tables use on-demand capacity, KMS encryption, `tenantId` as partition key, and `recordId` as sort key. Production enables point-in-time recovery and deletion protection. The outbox alone enables DynamoDB Streams.

## Access-pattern table

| Access pattern | Table / key or index | API/consumer |
|---|---|---|
| Capture by ID | `captures (tenantId, recordId)` | poll, complete, retry, worker |
| Captures by facility/status/time | `byFacilityStatus (facilityStatus, createdAt)` | operations |
| Observations by facility/time | `byFacilityTime (facilityId, capturedAt)` | observations |
| Observations by plate/time | approved internal `tenantPlate` index extension | investigation |
| Registration by tenant/facility/plate | `byFacilityPlate (authorizationScope, normalizedPlate)` | allowlist |
| Registration by tenant/plate | `byPlate (tenantPlate, createdAt)` | security evaluator |
| Open visit by facility/plate | deterministic `state_<sha256>` primary key | projector |
| Visits by facility/time | `byFacilityTime (facilityId, entryAt)` | visit history |
| Open visits | `byFacilityOpen (facilityOpen, entryAt)` | open visits |
| Open alerts by facility/time | `byFacilityStatus` / `byFacilityTime` | alerts |
| Outbox by status | `byPublishStatus (status, createdAt)` | backlog operations |
| Idempotency key | deterministic primary key, TTL | mutable APIs |
| Facility list | `byTenantCreated (tenantId, createdAt)` | navigation |
| Stations by facility | `byFacilityCreated (facilityId, createdAt)` | station |

No routine request calls `Scan`.

## Entities and important attributes

- **Tenant**: identity boundary represented on every row and Cognito membership.
- **User**: Cognito subject, groups, tenant/facility claims; no duplicate password store.
- **Facility**: name and IANA timezone.
- **CameraStation**: facility, name, `ENTRY|EXIT`, motion/cooldown settings, heartbeat/armed status.
- **RegisteredVehicle**: normalized/display plate, optional region, description, validity, `ACTIVE|EXPIRED|BLOCKED`, facility or `*` scope.
- **CaptureSession**: issued keys, client/estimated/received/uploaded/processing times, state and correlation.
- **PlateObservation**: candidates, quality, confidences, state, model version, protected media keys, review.
- **Visit**: entry/exit observation, times, dwell, `OPEN|CLOSED`, anomaly records.
- **SecurityAlert**: reason, masked plate, status and actor transitions.
- **AuditRecord**: append-only actor/action/resource/time and non-sensitive details.
- **OutboxEvent**: event envelope, `PENDING|PUBLISHED`, attempts and publish time.
- **IdempotencyRecord**: operation result with 24-hour TTL.

## Sensitive key discussion

Full plates remain encrypted data. EventBridge never carries them. Registration lookup uses internal DynamoDB attributes in the protected account; logs, metrics, URLs, email, and CloudFormation outputs do not. The deterministic visit-state key is a SHA-256 digest of tenant/facility/plate. Hashing does not make a low-entropy plate anonymous, so access remains restricted and encrypted.

## Transaction boundaries

Recognition completion uses one `TransactWriteItems` call for observation, capture transition, and outbox intent. Visit projection uses an event marker plus visit/state operations. Alert suppression uses a deterministic windowed alert key and conditional put.

Historical visits and raw model candidates are never overwritten to simulate a different past. Review adds a decision/audit record.
