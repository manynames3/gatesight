# ADR-010: No intentional local media persistence

## Context

Browser stations handle sensitive images on computers that may not be managed as evidence devices.

## Decision

Keep frames in memory only until direct upload/discard. Do not use storage APIs, offline cache, service workers, background sync, filesystem, or base64 image state.

## Alternatives considered

IndexedDB/offline buffering improves availability but increases local retention, deletion, encryption, and breach responsibilities. A native encrypted spool belongs to a different architecture.

## Consequences

Privacy exposure is reduced, but page/power/network failure can lose unuploaded captures. Browser memory paging prevents a forensic zero-disk guarantee.

## Revisit when

Offline capture is business-critical and a managed encrypted endpoint/agent with explicit retention and key management is approved.
