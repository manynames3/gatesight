# Security and threat model

Start with the core rule: uncertain recognition can create review work, but it
can never create an unregistered-vehicle claim.

## Assets

Vehicle images, plate readings/candidates, registration authorization, visits/alerts, tenant/facility membership, Cognito tokens, KMS keys, deployment roles, and audit evidence.

## Threats and controls

| Threat | Control |
| --- | --- |
| Public media exposure | Private bucket, Block Public Access, ownership enforcement, TLS-only, no public URLs |
| Upload to arbitrary key/type/size | Server key, exact-key POST condition, JPEG MIME, byte limit, capture metadata, short expiry |
| Cross-tenant object access | Gateway JWT + backend tenant/facility check on every operation |
| Role bypass in UI | Backend role dependencies and response redaction |
| Token theft from persistent storage | PKCE, session storage, short tokens, logout clear/revocation |
| CSRF | Bearer tokens, no credential cookies, restricted CORS |
| XSS/exfiltration | React escaping, restrictive CSP, no analytics identifiers, no raw HTML |
| Replay/duplicate mutation | Required idempotency keys, DynamoDB conditional writes, deterministic event markers |
| Image parser/decompression attack | POST size limit, content checks, bounded dimensions/pixels, memory decode |
| Plate leakage through observability | Structured allowlisted context; no plate log/metric dimensions |
| False security alert | State/direction/high-confidence/registration barrier; uncertainty cannot alert |
| Queue/event tampering | IAM resource scoping, encrypted queues, validated Pydantic/event schemas |
| Supply-chain/model replacement | uv/npm locks, immutable image digest, checksum manifest, Trivy/SBOM, provenance gate |
| Static cloud credentials | GitHub OIDC role only |
| Destructive production action | deletion protection/PITR, environment approval, explicit teardown |

## IAM boundaries

Each Lambda has a separate execution role. The API can query domain tables, presign/delete capture objects, and send recognition messages. The worker can read/write media, claim captures, and transactionally write observations/outbox. The publisher can read its stream, update outbox, and put only to the custom bus. Business consumers access only the tables/topic they need.

KMS permissions do not grant data access by themselves. Key policy review remains part of the deployment plan.

## Secrets

The browser receives only public Cognito configuration. No client secret exists. GitHub stores Cloudflare/API smoke secrets; AWS authentication is OIDC. Non-secret thresholds live in SSM Parameter Store. Do not put plates or tokens in environment variables.

## Residual risks

Cloud administrators can access encrypted data according to their IAM. A compromised operator browser can capture visible media/tokens. A plate hash is not anonymous due to low entropy. Browser-only unattended operation is susceptible to sleep, update, extension, and device-driver behavior. Organization controls should add CloudTrail, GuardDuty, Security Hub, access analysis, break-glass procedures, and WAF/rate policy.

## Security response

Revoke sessions/users, disable affected stations, preserve non-sensitive audit/correlation evidence, rotate compromised deployment secrets, quarantine image digests, and use PITR/versioning according to incident policy. Never copy plates into tickets or chat; refer by protected observation ID.
