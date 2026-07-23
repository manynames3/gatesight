# Failure-mode matrix

| Failure | Detection | Behavior | Recovery |
|---|---|---|---|
| Camera permission denied | `NotAllowedError` | No stream; clear UI fault | Browser/site permission |
| No camera | `NotFoundError`, empty devices | Station cannot arm | Attach/select camera |
| Camera disconnected | track `ended`, `devicechange` | Mark disconnected; stop auto assumptions | Reconnect and re-enable |
| Low-resolution camera | ideal constraint falls back | Capture continues; quality may review | Physical alignment/test |
| Browser/OS suspends tab | heartbeat stale | Capture unavailable | Operator/kiosk supervision |
| Offline before upload | online event, XHR error | Blobs stay only while page lives | Network return/retry or discard |
| Partial upload | one XHR/HeadObject fails | No completion/queue | Retry bounded while open |
| Presign expires | S3 rejects POST | No cross-session key reuse | Create a fresh session |
| Invalid/oversized image | API POST policy + worker validation | Reject/fail, never recognize | Investigate client/tampering |
| Duplicate completion | idempotency + conditional state | Return prior result; duplicate job safe | None |
| Queue backlog | depth/oldest age alarm | Capture still works; results delayed | Scale/concurrency/load review |
| Worker error | Lambda metric/SQS receive count | Retry then recognition DLQ | Runbook inspect/redrive |
| Worker fails after transaction | deterministic observation exists | Retry exits successfully | None |
| Outbox publish fails | stream retry/metric/iterator age | Outbox remains pending | Retry/repair publisher |
| Publish succeeds before status write | later republish | Consumers suppress duplicate | None |
| EventBridge delayed/out of order | captured time vs state | Conditional projection/anomaly | Human review if incompatible |
| Conflicting OCR | consensus policy | `NEEDS_REVIEW` | Human review |
| Multiple plates | detector count | `MULTIPLE_PLATES` | Human review |
| No plate | no candidates | `NO_PLATE` | No security classification |
| Registration table unavailable | consumer error | No alert decision committed | Retry; fail closed |
| SNS delivery fails | Lambda metric/error | Alert remains in dashboard | SNS/endpoint recovery |
| Stale heartbeat | station timestamp/alarm | Operational fault | Inspect browser/device |
| KMS denial | API/Lambda error | No unencrypted fallback | Repair IAM/key policy |
| Model checksum mismatch | container build gate | Image build fails | Verify source/manifest |
| Weight license unresolved | production release gate | Proprietary release blocked | Written terms/legal approval |

Fail closed means the evaluator creates no security classification when it cannot verify observation/registration evidence.
