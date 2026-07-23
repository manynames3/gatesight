# ADR-006: Lambda instead of ECS

## Context

Recognition is asynchronous, bursty, CPU-compatible, and should cost nothing for idle compute.

## Decision

Run FastALPR in a Python 3.12 Lambda container with baked ONNX artifacts, 4 GB memory, bounded concurrency, and no VPC.

## Alternatives considered

ECS/Fargate handles long/sustained jobs and custom hosts but adds tasks/services/capacity operations and idle or startup cost. EKS is disproportionate. GPU instances are unproven.

## Consequences

Image size, 15-minute limit, CPU/memory coupling, cold initialization, and concurrency must be measured. Capture remains unaffected by worker cold starts.

## Revisit when

Jobs exceed Lambda limits, utilization becomes sustained enough for ECS economics, GPU evidence is compelling, or hardware-specific runtimes are required.
