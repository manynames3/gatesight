# Third-party notices

GateSight depends on third-party packages and model artifacts. `uv.lock`, `apps/web/package-lock.json`, the SBOM workflow, and `ml/model-manifest.json` are the machine-readable inventories.

Key direct components:

| Component | Version/profile | Repository license |
|---|---|---|
| FastALPR | 0.4.0 | MIT |
| FastPlateOCR | 1.1.0 | MIT |
| open-image-models | 0.5.1 | MIT |
| ONNX Runtime | 1.22.1 | MIT |
| OpenCV | 4.12.0.88 package | Apache-2.0 |
| FastAPI | 0.116.1 | MIT |
| AWS Lambda Powertools Python | 3.17.0 | MIT-0 |
| React / React DOM | 19.1.1 | MIT |
| Vite | 7.1.3 | MIT |
| oidc-client-ts | 3.3.0 | Apache-2.0 |
| Terraform AWS Provider | 6.x | MPL-2.0 |
| PaddleOCR challenger | 3.7.0, evaluation only | Apache-2.0 repository |

Copyright and full license texts remain with their upstream distributions and generated SBOM/package metadata.

## Model-weight notice

The detector and OCR files are downloaded from GitHub release assets and SHA-256 checked. Their source repositories identify as MIT, but no separate weight redistribution terms or complete training-dataset provenance were found on the release pages reviewed on 2026-07-23. GateSight does **not** infer that a package/repository license automatically licenses every weight or dataset.

`ml/model-manifest.json` marks those artifacts `REVIEW_REQUIRED`. Obtain written maintainer confirmation and legal approval before proprietary redistribution, then record the evidence and change the release status. The production release gate must use `--require-redistribution-approval`.

No Ultralytics AGPL package/weight, EasyOCR production engine, OpenALPR, YOLOv12, or YOLO26 artifact is included.
