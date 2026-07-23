# GateSight implementation plan

## Delivery principles

- Preserve capture responsiveness by making recognition asynchronous.
- Keep media private and in memory in the browser until direct S3 upload completes.
- Treat uncertain recognition as review work, never as evidence that a vehicle is unregistered.
- Keep domain rules independent from Lambda handlers and AWS SDK clients.
- Make retries, duplicate delivery, and out-of-order delivery normal operating conditions.
- Pin application dependencies and model metadata, and never download weights during invocation.

## Work sequence

1. Define state machines, access patterns, versioned contracts, security boundaries, and architecture decisions.
2. Build a vertical slice from browser capture through presigned uploads, explicit completion, SQS recognition, transactional observation persistence, and API polling.
3. Add confidence-weighted multi-frame consensus, quality checks, review, registration, visit pairing, and security alert rules.
4. Add the transactional outbox, EventBridge consumers, idempotency, audit records, tenant isolation, and role enforcement.
5. Build the automotive-operations web experience with camera lifecycle handling, motion/stability triggering, memory-only image handling, upload retry, wake lock, time synchronization, and authenticated routing.
6. Provision AWS resources with Terraform and Cloudflare Pages configuration.
7. Add unit, integration, browser, security, contract, container, and infrastructure validation.
8. Add CI/CD, operational dashboards and alarms, runbooks, privacy/security/model documentation, and reviewer onboarding.
9. Run every locally available check, fix actionable findings, and record credential-dependent validation honestly.

## State machines

### Capture

`CREATED -> UPLOADING -> QUEUED -> PROCESSING -> {RECOGNIZED | NEEDS_REVIEW | NO_PLATE | MULTIPLE_PLATES | FAILED}`

- `CREATED -> QUEUED` requires successful `HeadObject` verification for every server-issued frame key.
- Completion is a conditional transition and is protected by an idempotency key.
- Retry is allowed only from `FAILED` and creates a new attempt without rewriting audit history.

### Observation review

`PENDING -> CONFIRMED | CORRECTED | REJECTED`

- Automated `RECOGNIZED` results remain machine decisions until reviewed.
- Corrections retain raw candidates and append an audit record.

### Visit

`OPEN -> CLOSED`

- A repeated entry while open creates an anomaly; it does not replace the original entry.
- An unmatched exit creates an orphan-exit anomaly.

### Security alert

`OPEN -> ACKNOWLEDGED -> RESOLVED`

- Only high-confidence recognized entries can enter this state machine.
- Blocked registrations alert; active authorized registrations do not.

## Verification gates

- Python: Ruff, mypy, pytest, Bandit, dependency audit.
- Web: ESLint, strict TypeScript, Vitest, Playwright Chromium and WebKit, production build.
- Infrastructure: Terraform format/validate, TFLint, Checkov.
- Supply chain: model-manifest hashes, Docker build, Trivy, SBOM, secret scan.
- AWS: smoke and real temporary-environment end-to-end tests after credentials and environment authorization are supplied.

## Credential-dependent work

Local implementation and validation require no cloud credentials. ECR push, Terraform apply, Cognito user invitation, Cloudflare Pages deployment, SNS subscription confirmation, and real AWS end-to-end tests are intentionally deferred until authorized credentials are configured.
