# ADR-007: FastALPR and FastPlateOCR model selection

## Context

The production path needs plate-specific detection/OCR, ONNX CPU inference, per-candidate confidence, and no AGPL dependency.

## Decision

Pin FastALPR 0.4.0, FastPlateOCR 1.1.0, open-image-models 0.5.1, YOLOv9-S 608 detector, and CCT-S-v2 global OCR. Bake checksum-pinned artifacts. Keep PaddleOCR PP-OCRv6-small evaluation-only.

## Alternatives considered

EasyOCR is general-purpose and not the selected production evidence path. OpenALPR is excluded. YOLOv12 and unlicensed YOLO26 are excluded. PaddleOCR adds a larger production runtime until measurements justify it.

## Consequences

The selected profile is implementable on CPU and preserves character evidence. Accuracy is unmeasured locally. Weight redistribution/provenance remains a hard production release gate despite MIT repositories.

## Revisit when

A rights-cleared labeled comparison shows a challenger improves accepted accuracy/false-alert/latency/cost and its code, weights, datasets, and redistribution terms pass review.
