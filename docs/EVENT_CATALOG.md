# Event catalog

## Recognition job (SQS)

`RecognitionJob.v1` is internal work, not a domain event. It contains schema version, capture/tenant/facility/station IDs, direction, correlation ID, bucket, three-to-five exact object keys, audit timestamps, and facility timezone. It never includes bytes, plate text, email, or tokens.

Producer: control API after explicit completion and `HeadObject` verification.
Consumer: recognition worker, batch size 1.
Delivery: at least once; retry and DLQ.
Schema: `packages/contracts/recognition-job.v1.schema.json`.

## `com.gatesight.plate-recognition.completed.v1`

CloudEvents-inspired envelope:

```json
{
  "specversion": "1.0",
  "id": "out_<capture-ulid>",
  "type": "com.gatesight.plate-recognition.completed.v1",
  "source": "/services/recognition-worker",
  "subject": "observations/obs_<capture-ulid>",
  "time": "2026-07-23T12:00:00Z",
  "datacontenttype": "application/json",
  "correlationId": "cor_<ulid>",
  "tenantId": "ten_<ulid>",
  "data": {
    "observation_id": "obs_<ulid>",
    "capture_id": "cap_<ulid>",
    "facility_id": "fac_<ulid>",
    "station_id": "sta_<ulid>",
    "direction": "ENTRY",
    "state": "RECOGNIZED",
    "captured_at": "2026-07-23T11:59:57Z",
    "confidence_category": "HIGH",
    "lookup_token": null
  }
}
```

Producer: recognition transactional outbox → stream publisher.
Consumers: visit projector and security evaluator.
Schema: `packages/contracts/plate-recognition-completed.v1.schema.json`.

Consumers fetch protected plate evidence using observation ID and tenant ID. Raw image, full plate, raw OCR, email, and authorization data are forbidden.

## Delivery behavior

- **Duplicate:** outbox may publish twice; each consumer records a deterministic event marker or resource key.
- **Delayed:** domain ordering uses estimated capture time, not delivery time.
- **Out of order:** consumers compare capture time/state and record anomalies; they do not rewrite historical facts.
- **Poison event:** EventBridge retries for up to 24 hours. Consumer errors and throttles alarm. A future per-target DLQ should be added if the organization requires retention beyond the configured retry policy.
- **Compatibility:** additive optional fields are permitted in a new minor contract workflow; removing/renaming fields or changing meaning requires a new `.v2` event type.
