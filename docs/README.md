# GateSight documentation

You do not need to read every document.

Pick the question you are trying to answer and take the shortest path.

## I want the product story

Start with the main [README](../README.md).

You will learn:

- what GateSight does;
- why capture happens before recognition;
- how visits and alerts work; and
- where the current limits are.

## I want to understand the system

Read these in order:

1. [Architecture](ARCHITECTURE.md) — components, trust boundaries, state, and consistency.
2. [Data model](DATA_MODEL.md) — tables, indexes, entities, and transaction boundaries.
3. [Event catalog](EVENT_CATALOG.md) — recognition work and completed-recognition events.

Then use the [architecture decision records](adr/README.md) when you need to
understand why a design choice was made.

## I need to operate or troubleshoot it

Start with:

1. [Production runbook](RUNBOOK.md)
2. [Failure-mode matrix](FAILURE_MODES.md)
3. [Physical camera checklist](PHYSICAL_CAMERA_TEST_CHECKLIST.md)

The runbook tells you what to do. The failure matrix tells you what the system should do. The camera checklist proves the browser/device path still behaves that way.

## I need to test a change

Use:

- [Testing strategy](TESTING.md) for automated and AWS coverage;
- [Physical camera checklist](PHYSICAL_CAMERA_TEST_CHECKLIST.md) for real-device behavior; and
- [`ml/evaluation`](../ml/evaluation/README.md) for model evaluation.

## I need to review risk

Read:

1. [Security and threat model](SECURITY.md)
2. [Privacy and retention](PRIVACY.md)
3. [Model card](MODEL_CARD.md)
4. [Cost assumptions](COST.md)

The model card is especially important before any commercial release. Current portfolio use does not grant commercial-use or weight-redistribution rights.

## Quick reference

| Document | Best for |
| --- | --- |
| [README](../README.md) | Product overview and setup |
| [Architecture](ARCHITECTURE.md) | System and trust boundaries |
| [Data model](DATA_MODEL.md) | DynamoDB design and transactions |
| [Event catalog](EVENT_CATALOG.md) | SQS and EventBridge contracts |
| [Runbook](RUNBOOK.md) | Incident response and recovery |
| [Failure modes](FAILURE_MODES.md) | Expected behavior under faults |
| [Testing](TESTING.md) | Coverage and commands |
| [Camera checklist](PHYSICAL_CAMERA_TEST_CHECKLIST.md) | Browser and physical validation |
| [Security](SECURITY.md) | Threats and controls |
| [Privacy](PRIVACY.md) | Collection, retention, and deletion |
| [Model card](MODEL_CARD.md) | Intended use, limits, and release gate |
| [Cost](COST.md) | Planning assumptions |
| [Decision records](adr/README.md) | Why important design choices were made |
