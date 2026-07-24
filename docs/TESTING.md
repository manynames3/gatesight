# Testing strategy

The test strategy answers one question: what evidence do we have that GateSight will capture, recognize, recover, and fail safely?

## What good looks like

- Fast local tests protect domain rules and browser behavior.
- Static checks protect type, formatting, infrastructure, and supply-chain boundaries.
- Real AWS tests prove cloud integration.
- Physical tests prove the camera, browser, network, and operator workflow.
- The deployment canary proves capture, recognition, entry/exit projection, and media deletion.

No single layer is allowed to claim coverage that belongs to another.

## Pyramid

- Pure domain/property tests: normalization, edit distance, consensus, alerts, visit pairing.
- Component tests: image validation/quality, cursors, claims, deterministic IDs, API adapters with moto where useful.
- Browser tests: permissions, no camera, disconnect, lower resolution, burst lifecycle, in-memory discard, upload retry, polling.
- Real integration: an explicitly authorized temporary AWS environment; no LocalStack/moto claim.
- Physical: browser/device checklist.
- Static/supply chain: Ruff, mypy, ESLint, TypeScript, Bandit, pip-audit, Checkov, TFLint, Trivy, gitleaks, SBOM, checksums.

## Required-scenario map

| Scenario | Coverage |
| --- | --- |
| Permission denied / no camera / disconnect / low resolution | browser hook + Playwright/physical checklist |
| Partial upload / expired presign | upload component + real AWS E2E |
| Invalid type / oversized / decompression bomb | `test_quality.py`, S3 POST policy |
| Duplicate completion / SQS / outbox / EventBridge | idempotency/conditional component and AWS retry tests |
| Worker retry after Dynamo write | deterministic ID + real transaction fault injection |
| One-frame plate / conflict / low confidence / multiple / no candidates | `test_consensus.py` |
| Registered/unregistered/blocked entry; unregistered exit | `test_security.py` |
| Duplicate/repeated entry; orphan/delayed exit | `test_visits.py`, projector integration |
| Unauthorized tenant/role | claim/API component tests + AWS E2E |
| Media deletion | API/S3 integration + audit assertion |
| DLQ redrive | real AWS E2E/runbook exercise |
| Raw plate absent from logs | structured logging capture test and CloudWatch query review |
| Guide detector miss / OCR fallback | recognition-engine and consensus tests + canary |
| Fresh upload instructions | S3 verification and API/client tests |
| Uncommissioned station | health-store and heartbeat-monitor tests |

Some scenarios require deployed-service fault injection. Local mocks are useful, but they are never presented as production proof.

## Commands

Start with the smallest command that can disprove your change:

```bash
make test-unit
make test
make test-integration
make test-e2e
make lint
make security
make build-worker
terraform fmt -check -recursive infrastructure/terraform
```

Set `GATESIGHT_AWS_E2E=1` only for the named, temporary AWS environment. Physical camera testing is never fully automated.

## Reliability release targets

These are release gates, not current performance claims:

- less than 1% false rejection before upload;
- at least 99% detector recall for a guide-aligned plate;
- at least 98% exact accuracy among automatically accepted readings;
- at least 99.5% successful AWS capture completion;
- zero security alerts from review, uncertainty, or synthetic canaries; and
- capture-to-observation p95 below 10 seconds warm and 20 seconds cold.

Measure them on a rights-cleared, facility-representative dataset before calling
the system production-ready.
