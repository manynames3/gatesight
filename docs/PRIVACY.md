# Privacy and retention

License plates and vehicle images are sensitive operational data.

Collect them only for authorized facility operations, keep access narrow, and
delete them on a documented schedule. GateSight performs no facial recognition
or person identification.

## Collection notice

GateSight does not put a privacy-acknowledgment checkbox in the capture path.
Automatic capture becomes active when camera permission, a facility, and a
station are available. The facility is therefore responsible for approved
physical notice/signage, a documented lawful purpose, access roles, and
applicable data-subject requirements.

The documented purpose is vehicle-gate operation. No facial recognition or
person identification occurs, and media is not intentionally persisted on the
browser device.

## Local-device behavior

Images exist as in-memory browser `Blob`s until successful upload or discard. GateSight does not write them to Web Storage, IndexedDB, Cache Storage, OPFS, service-worker caches, filesystem APIs, or base64 state. Canvas pixels are cleared. Browser/OS memory management may spill pages to disk; no forensic zero-disk claim is made.

No offline persistence improves privacy but reduces availability: an unuploaded capture can be lost if the browser, computer, power, or network fails.

## Cloud retention

- Private S3, TLS-only, Block Public Access, Bucket Owner Enforced, KMS, versioning.
- Dev raw/derived media default: 1 day.
- Production raw/derived media default: 30 days.
- Incomplete multipart uploads and noncurrent versions: 1 day.
- Temporary capture/idempotency rows use TTL; historical/audit retention must follow facility policy.
- CloudWatch defaults to 14 days dev and 90 days production.

## Access and deletion

There are no public object URLs. Security/admin access is tenant/facility checked. `POST /v1/observations/{id}/delete-media` removes raw media and creates an audit fact with actor/time/resource, without retaining bytes. SNS never includes raw images or full plates.

Backups/PITR and S3 versioning can affect deletion timelines; production policy must document those recovery windows.

## Logging minimization

Logs include correlation, tenant, facility, capture, observation, and model version—not full plates, raw OCR, images, emails, or tokens. Errors expose stable codes and correlation IDs; exception details stay redacted.
