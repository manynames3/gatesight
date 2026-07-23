# Production runbook

## First triage

1. Note environment, UTC time, alarm, correlation/capture/observation ID—never copy a plate.
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

Inspect publisher errors, stream iterator age, EventBridge failed entries, IAM, and event schema. Pending rows remain durable. A publish-before-update retry can duplicate; consumers are designed for it.

## Stale station

Contact the facility, inspect network/power/browser visibility/camera track and wake-lock status, disarm if unattended capture is unreliable, then re-enable and perform a physical test burst. Tune alarm schedules to operating hours.

## Rollback

Use `.github/workflows/rollback.yml` with a previously approved ECR URI by digest. Wait for Lambda update and run an authenticated smoke. Cloudflare Pages retains deployments; use the Cloudflare dashboard/API to promote the prior reviewed deployment, then repeat smoke/camera checks. Never roll back DynamoDB schema/state blindly; use forward-compatible migrations and PITR only under incident command.

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
