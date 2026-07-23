# Model evaluation

Evaluation is intentionally separate from production. Create a rights-cleared manifest matching `dataset.schema.json`, run the production engine and optional challenger to produce the documented prediction JSON shape, then run:

```bash
uv run python ml/evaluation/evaluate.py \
  --dataset private-evaluation/dataset.json \
  --predictions private-evaluation/fastplate-predictions.json \
  --output build/evaluation/fastplate
```

The PaddleOCR PP-OCRv6 challenger is optional and never part of the recognition image. Its results do not change production automatically. A replacement requires a documented ADR, licensing review, container/latency measurement, and explicit approval.

No labeled images ship with the repository because provenance and allowed use must be explicit.
