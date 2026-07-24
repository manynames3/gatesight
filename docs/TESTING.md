# Testing strategy

## Pyramid

- Pure domain/property tests: normalization, edit distance, consensus, alerts, visit pairing.
- Component tests: image validation/quality, cursors, claims, deterministic IDs, API adapters with moto where useful.
- Browser tests: permissions, no camera, disconnect, lower resolution, burst lifecycle, in-memory discard, upload retry, polling.
- Real integration: an explicitly authorized temporary AWS environment; no LocalStack/moto claim.
- Physical: browser/device checklist.
- Static/supply chain: Ruff, mypy, ESLint, TypeScript, Bandit, pip-audit, Checkov, TFLint, Trivy, gitleaks, SBOM, checksums.

## Required-scenario map

| Scenario | Coverage |
|---|---|
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

Some scenarios need deployed-service fault injection; local mocks are not represented as production proof.

## Commands

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

Set `GATESIGHT_AWS_E2E=1` only for the temporary account/environment named by the remaining variables. Physical camera testing is never fully automated.
