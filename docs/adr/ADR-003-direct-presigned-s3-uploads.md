# ADR-003: Direct presigned S3 uploads

## Context

Image bursts are larger than control messages and should not consume API Gateway/Lambda bandwidth or memory.

## Decision

The API creates server keys and short-lived presigned POSTs restricted by exact key, JPEG MIME, metadata, and byte range. Completion verifies every object with `HeadObject`.

## Alternatives considered

Proxying through FastAPI centralizes validation but increases latency/cost/limits. Public or broadly presigned objects violate privacy. Multipart is unnecessary at current frame sizes.

## Consequences

S3 CORS/CSP must include configured origins. Partial uploads are explicit. The browser talks directly to AWS without receiving bucket credentials.

## Revisit when

Frame sizes require multipart, a malware/content inspection proxy becomes mandatory, or network policy forbids direct S3.
