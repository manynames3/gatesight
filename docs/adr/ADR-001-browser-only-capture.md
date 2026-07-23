# ADR-001: Browser-only capture instead of a local Python agent

## Context

A reviewer or operator must use a built-in/connected camera on a modern computer without installing a privileged agent.

## Decision

Use standards-based `getUserMedia`, ImageCapture/canvas, and an explicit browser station. Do not intentionally persist media locally.

## Alternatives considered

A Python/desktop agent gives stronger supervision, device policy, and offline durability but creates installation, signing, update, privilege, and cross-platform burden. A managed camera appliance is operationally stronger but outside the portfolio onboarding goal.

## Consequences

New computers work through the Hosted UI and permission prompt. OS sleep, tab lifecycle, driver changes, and best-effort Wake Lock limit unattended reliability. Offline captures may be lost.

## Revisit when

A facility requires 24×7 unattended SLA, offline buffering, multiple synchronized cameras, hardware triggers, or managed OS/device health.
