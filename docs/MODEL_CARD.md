# Model card

## Intended use

Detect and transcribe visible vehicle license plates at controlled facility gates, then route evidence into operational review, visit pairing, and guarded entry alerts.

## Out of scope

Person/facial identification, law-enforcement identification, public surveillance, moving traffic enforcement, inference of owner identity, or decisions based solely on an uncertain plate.

## Production profile

Detector: `yolo-v9-s-608-license-plate-end2end` via `open-image-models==0.5.1`.
OCR: `cct-s-v2-global-model` via `fast-plate-ocr==1.1.0`.
Integration: `fast-alpr==0.4.0`.
Runtime: ONNX Runtime CPU on Python 3.12 Lambda container.

Hashes, URLs, byte sizes, and license review state are in `ml/model-manifest.json`. Sessions initialize outside the production handler; artifacts are build-time only.

## Decision policy

Automation requires exact agreement across at least two usable frames, strong combined evidence, and no conflicting high-confidence reading. Multiple plausible plates, small/blurred/glared crops, one-frame detections, low confidence, or conflict produce review/no-plate states. Normalization never substitutes characters. Regional patterns can inform review only.

## Risks and limitations

Performance varies by region, typography, temporary plates, dirt, obstruction, angle, distance, glare, motion, weather, night illumination, and camera compression. Training data provenance is not fully documented by the asset release. A global model can underperform on a specific facility or plate population. Confidence scores are not automatically calibrated probabilities.

## Evaluation

No performance result is claimed. The repository has no rights-cleared labeled dataset. The evaluation harness reports detector precision/recall/mAP, OCR exact match/CER, end-to-end exact match, coverage, accepted accuracy, false alert rate, review rate, latency, cold start, and image size across documented condition slices.

Targets are ≥98% exact match among accepted observations and <0.1% false unregistered-alert rate. These are gates, not results.

PaddleOCR PP-OCRv6-small is a separately installed challenger. Replacement requires measured evidence, licensing review, container/cost evaluation, and a new ADR.

## Monitoring

Monitor recognition state rates, review rate, no-plate rate, processing duration, cold starts, failures, and false-alert outcomes from reviewed samples. Never use plate values as metric dimensions.

## Release gate

The code repositories advertise MIT and publish the selected pretrained assets for
inference. A non-commercial portfolio deployment may keep the verified weights inside
a private ECR image. Separate weight redistribution and complete dataset-provenance
terms were not found on the release pages, so commercial use and redistribution remain
blocked until confirmation and legal approval change the release gate and each artifact
to `APPROVED`.
