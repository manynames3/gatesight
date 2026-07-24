# Cost assumptions

Use these figures for planning, not approval. Measure real frame size,
recognition duration, request volume, and retention before setting a production
budget.

GateSight avoids always-running services. The following is an illustrative
planning model, not a quote:

- 30,000 capture bursts/month, four 1.5 MB frames each: ~180 GB uploaded before lifecycle expiry.
- 30,000 recognition invocations at 4 GB and 8 seconds average: ~960,000 GB-seconds.
- S3 PUT/GET/lifecycle, KMS requests, on-demand DynamoDB reads/writes, SQS/EventBridge/SNS requests, ECR storage/scanning, API requests, and CloudWatch logs/metrics.
- Dev retains media one day/logs 14 days; prod media 30 days/logs 90 days.

Use the AWS Pricing Calculator in the target region with measured frame size/latency. CloudWatch custom metrics and KMS request counts can be material at high volume. Enhanced ECR scanning can carry account-level cost. SNS email volume is usually small but is optional.

The sample AWS Budget alerts at 80% forecast and 100% actual. Defaults are $30/month dev and $100/month prod; set values to the organization’s expected traffic.

Cost-driven alternatives:

- Lower JPEG size only after accuracy evaluation.
- Shorten media/log retention according to policy.
- Select a smaller detector only after accepted-accuracy/false-alert comparison.
- Reserved/provisioned concurrency only if measured cold-start/throughput needs justify cost.
- ECS becomes plausible only for sustained utilization where Lambda economics/limits lose.

There is no NAT Gateway, VPC endpoint fleet, RDS, ECS/Fargate, EKS, Kinesis, or Step Functions charge.
