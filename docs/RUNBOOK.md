# Production runbook

Use this guide when GateSight is slow, unavailable, backed up, or producing an unexpected operational result.

## Three rules before you touch anything

1. Capture IDs and correlation IDs are safe incident references. Plate text and images are not.
2. Fix the cause before redriving or replaying work.
3. Prefer conditional, idempotent recovery over manual record rewriting.

## Where should I start?

| Symptom | Start here |
| --- | --- |
| Recognition is delayed | Queue depth/age, then worker errors |
| Capture failed after upload | Recognition DLQ |
| Observation exists but visits/alerts do not | Outbox and consumer errors |
| Automatic capture stopped | Stale station |
| A deployment caused the problem | Rollback |
| A user requested image removal | Media deletion |

## First triage

1. Note the environment, UTC time, alarm, and correlation/capture/observation ID. Never copy a plate.
2. Check the CloudWatch dashboard flow left to right: API, queue depth/age, worker errors/duration, outbox iterator age, consumer errors, SNS.
3. Confirm whether capture continues. Queue backlog should delay results without blocking new browser photographs/uploads.
4. Use X-Ray/logs with correlation ID; do not enable request/event logging containing sensitive payloads.

## Recognition DLQ

1. Restrict the operator to `ADMIN`; inspect `/v1/system/dlq` metadata.
2. Locate source capture and worker error by message/correlation ID.
3. Determine whether the fault is transient, malformed input, model/container, IAM/KMS, or code.
4. Fix the cause first. Do not repeatedly redrive malformed data.
5. Redrive one message through `POST /v1/system/dlq/{messageId}/redrive`.
6. Confirm observation/outbox or documented `FAILED` capture; confirm DLQ and queue-age alarms recover.
7. Record operator/time/cause/outcome in the incident system without plate/image data.

For bulk redrive, use the SQS redrive API with an approved change and bounded velocity.

## Outbox backlog

Check publisher errors, stream iterator age, EventBridge failed entries, IAM, and event schema—in that order.

Pending rows remain durable. A publish-before-update retry can duplicate an event; consumers are designed to handle that safely.

## Stale station

1. Contact the facility.
2. Check power, network, browser visibility, camera track, and Wake Lock.
3. Close the camera page or revoke camera permission if automatic capture is
   unreliable.
4. Restore the station and complete a physical test burst.
5. Align alarm schedules with facility operating hours.

## Rollback

### AWS worker

Use `.github/workflows/rollback.yml` with a previously approved ECR URI by digest. Wait for the Lambda update, then run an authenticated smoke test.

### Web application

Cloudflare Pages retains deployments. Promote the previous reviewed deployment, then repeat smoke and camera checks.

Never roll back DynamoDB schema or state blindly. Use forward-compatible migrations and PITR only under incident command.

## Media deletion

Use the protected observation endpoint. Verify `mediaAvailable=false`, the S3 deletion response, and the audit record. Explain versioning/PITR recovery windows to the requester.

## Teardown

Dev only:

1. Export required audit/evaluation evidence according to policy.
2. Empty versioned S3 objects if Terraform cannot because retention/config changed.
3. Disable Cognito users and SNS subscriptions.
4. Run `make destroy ENV=dev`, review the plan, and confirm.
5. Remove orphan ECR images, Cloudflare preview deployment/project if authorized, state/lock entries only after destroy.

Production has deletion protection. A production teardown requires a separately approved change to disable it; `make destroy` refuses `ENV=prod`.
