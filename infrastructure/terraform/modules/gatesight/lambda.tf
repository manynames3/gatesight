data "aws_iam_policy_document" "assume_lambda" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "lambda" {
  for_each           = local.lambda_services
  name               = "${local.prefix}-${each.key}"
  assume_role_policy = data.aws_iam_policy_document.assume_lambda.json
  tags               = local.common_tags
}

resource "aws_cloudwatch_log_group" "lambda" {
  #checkov:skip=CKV_AWS_338:Privacy-aware retention is environment-configurable (90 days in production); structured logs exclude plates and media.
  for_each          = local.lambda_services
  name              = "/aws/lambda/${local.prefix}-${each.key}"
  retention_in_days = var.log_retention_days
  kms_key_id        = aws_kms_key.data.arn
  tags              = local.common_tags
}

data "aws_iam_policy_document" "logs" {
  for_each = local.lambda_services
  statement {
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.lambda[each.key].arn}:*"]
  }
  statement {
    actions   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "logs" {
  for_each = local.lambda_services
  name     = "logs-and-traces"
  role     = aws_iam_role.lambda[each.key].id
  policy   = data.aws_iam_policy_document.logs[each.key].json
}

data "aws_iam_policy_document" "control_api" {
  statement {
    actions = [
      "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem",
      "dynamodb:DeleteItem", "dynamodb:Query", "dynamodb:TransactWriteItems"
    ]
    resources = concat(
      [for table in aws_dynamodb_table.domain : table.arn],
      [for table in aws_dynamodb_table.domain : "${table.arn}/index/*"]
    )
  }
  statement {
    actions   = ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.captures.arn}/*"]
  }
  statement {
    actions   = ["s3:GetBucketLocation"]
    resources = [aws_s3_bucket.captures.arn]
  }
  statement {
    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.recognition.arn]
  }
  statement {
    actions   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"]
    resources = [aws_sqs_queue.recognition_dlq.arn]
  }
  statement {
    actions   = ["kms:Decrypt", "kms:Encrypt", "kms:GenerateDataKey"]
    resources = [aws_kms_key.data.arn]
  }
}

data "aws_iam_policy_document" "recognition" {
  statement {
    actions   = ["s3:GetObject", "s3:PutObject"]
    resources = ["${aws_s3_bucket.captures.arn}/*"]
  }
  statement {
    actions = ["dynamodb:GetItem", "dynamodb:UpdateItem", "dynamodb:TransactWriteItems"]
    resources = [
      aws_dynamodb_table.domain["captures"].arn,
      aws_dynamodb_table.domain["observations"].arn,
      aws_dynamodb_table.outbox.arn
    ]
  }
  statement {
    actions = ["dynamodb:PutItem"]
    resources = [
      aws_dynamodb_table.domain["observations"].arn,
      aws_dynamodb_table.outbox.arn
    ]
  }
  statement {
    actions   = ["ssm:GetParameter", "ssm:GetParameters"]
    resources = ["arn:${data.aws_partition.current.partition}:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/${local.prefix}/recognition/*"]
  }
  statement {
    actions   = ["kms:Decrypt", "kms:Encrypt", "kms:GenerateDataKey"]
    resources = [aws_kms_key.data.arn]
  }
  statement {
    actions   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"]
    resources = [aws_sqs_queue.recognition.arn]
  }
}

data "aws_iam_policy_document" "outbox_publisher" {
  statement {
    actions   = ["events:PutEvents"]
    resources = [aws_cloudwatch_event_bus.domain.arn]
  }
  statement {
    actions   = ["dynamodb:UpdateItem"]
    resources = [aws_dynamodb_table.outbox.arn]
  }
  statement {
    actions   = ["dynamodb:GetRecords", "dynamodb:GetShardIterator", "dynamodb:DescribeStream", "dynamodb:ListStreams"]
    resources = [aws_dynamodb_table.outbox.stream_arn]
  }
  statement {
    actions   = ["kms:Decrypt"]
    resources = [aws_kms_key.data.arn]
  }
}

data "aws_iam_policy_document" "visit_projector" {
  statement {
    actions   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:TransactWriteItems"]
    resources = [aws_dynamodb_table.domain["observations"].arn, aws_dynamodb_table.domain["visits"].arn]
  }
  statement {
    actions   = ["ssm:GetParameter", "ssm:GetParameters"]
    resources = ["arn:${data.aws_partition.current.partition}:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/${local.prefix}/recognition/*"]
  }
  statement {
    actions   = ["kms:Decrypt"]
    resources = [aws_kms_key.data.arn]
  }
}

data "aws_iam_policy_document" "security_evaluator" {
  statement {
    actions = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:Query"]
    resources = [
      aws_dynamodb_table.domain["observations"].arn,
      aws_dynamodb_table.domain["registrations"].arn,
      "${aws_dynamodb_table.domain["registrations"].arn}/index/byPlate",
      aws_dynamodb_table.domain["alerts"].arn
    ]
  }
  statement {
    actions   = ["ssm:GetParameter", "ssm:GetParameters"]
    resources = ["arn:${data.aws_partition.current.partition}:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/${local.prefix}/recognition/*"]
  }
  statement {
    actions   = ["sns:Publish"]
    resources = [aws_sns_topic.security.arn]
  }
  statement {
    actions   = ["kms:Decrypt", "kms:GenerateDataKey"]
    resources = [aws_kms_key.data.arn]
  }
}

data "aws_iam_policy_document" "heartbeat_monitor" {
  statement {
    actions   = ["dynamodb:Scan"]
    resources = [aws_dynamodb_table.domain["stations"].arn]
  }
}

resource "aws_iam_role_policy" "service" {
  for_each = {
    control-api        = data.aws_iam_policy_document.control_api.json
    recognition-worker = data.aws_iam_policy_document.recognition.json
    outbox-publisher   = data.aws_iam_policy_document.outbox_publisher.json
    visit-projector    = data.aws_iam_policy_document.visit_projector.json
    security-evaluator = data.aws_iam_policy_document.security_evaluator.json
    heartbeat-monitor  = data.aws_iam_policy_document.heartbeat_monitor.json
  }
  name   = "service-access"
  role   = aws_iam_role.lambda[each.key].id
  policy = each.value
}

resource "aws_lambda_function" "control_api" {
  #checkov:skip=CKV_AWS_115:Production reserves concurrency; development leaves it unreserved because the portfolio account has a ten-concurrency regional quota.
  #checkov:skip=CKV_AWS_117:This serverless API uses only AWS-managed public endpoints; a VPC would add NAT cost and no private data path.
  #checkov:skip=CKV_AWS_116:API Gateway invokes synchronously, so errors return to the caller and are alarmed rather than sent to a Lambda DLQ.
  #checkov:skip=CKV_AWS_272:ZIP signing requires environment-owned Signer profiles; deployment provenance is OIDC-bound and the artifact is immutable.
  function_name                  = "${local.prefix}-control-api"
  role                           = aws_iam_role.lambda["control-api"].arn
  runtime                        = "python3.12"
  handler                        = "gatesight_control_api.main.handler"
  filename                       = "${var.lambda_zip_directory}/control-api.zip"
  source_code_hash               = filebase64sha256("${var.lambda_zip_directory}/control-api.zip")
  memory_size                    = 512
  timeout                        = 29
  architectures                  = ["arm64"]
  kms_key_arn                    = aws_kms_key.data.arn
  reserved_concurrent_executions = local.is_production ? 20 : -1
  tracing_config { mode = "Active" }
  environment {
    variables = {
      GATESIGHT_ENVIRONMENT                  = var.environment
      GATESIGHT_AWS_REGION                   = var.aws_region
      GATESIGHT_CAPTURE_BUCKET               = aws_s3_bucket.captures.id
      GATESIGHT_RECOGNITION_QUEUE_URL        = aws_sqs_queue.recognition.id
      GATESIGHT_DLQ_URL                      = aws_sqs_queue.recognition_dlq.id
      GATESIGHT_TABLE_PREFIX                 = local.prefix
      GATESIGHT_ALLOWED_ORIGINS              = join(",", var.web_origins)
      GATESIGHT_DASHBOARD_URL                = var.dashboard_url
      GATESIGHT_PRESIGNED_EXPIRATION_SECONDS = "180"
      POWERTOOLS_SERVICE_NAME                = "control-api"
      POWERTOOLS_METRICS_NAMESPACE           = "GateSight"
      LOG_LEVEL                              = "INFO"
    }
  }
  depends_on = [aws_cloudwatch_log_group.lambda, aws_iam_role_policy.service]
  tags       = local.common_tags
}

resource "aws_lambda_function" "recognition" {
  #checkov:skip=CKV_AWS_115:Production reserves concurrency; development leaves it unreserved because the portfolio account has a ten-concurrency regional quota.
  #checkov:skip=CKV_AWS_117:The worker uses S3, SQS, DynamoDB, SSM, and KMS public service endpoints; avoiding a VPC removes NAT exposure and cost.
  #checkov:skip=CKV_AWS_116:The SQS event source owns retry and an encrypted DLQ; a Lambda asynchronous DLQ does not apply.
  #checkov:skip=CKV_AWS_272:Lambda code signing does not support container images; CI signs and verifies the immutable ECR digest with Cosign.
  function_name                  = "${local.prefix}-recognition-worker"
  role                           = aws_iam_role.lambda["recognition-worker"].arn
  package_type                   = "Image"
  image_uri                      = var.worker_image_uri
  memory_size                    = local.is_production ? 4096 : 3008
  timeout                        = 120
  architectures                  = ["x86_64"]
  kms_key_arn                    = aws_kms_key.data.arn
  reserved_concurrent_executions = local.is_production ? 10 : -1
  ephemeral_storage { size = 1024 }
  tracing_config { mode = "Active" }
  environment {
    variables = {
      GATESIGHT_TABLE_PREFIX       = local.prefix
      GATESIGHT_CONFIG_PREFIX      = "/${local.prefix}/recognition"
      GATESIGHT_PRELOAD_MODELS     = "1"
      POWERTOOLS_SERVICE_NAME      = "recognition-worker"
      POWERTOOLS_METRICS_NAMESPACE = "GateSight"
      LOG_LEVEL                    = "INFO"
    }
  }
  depends_on = [aws_cloudwatch_log_group.lambda, aws_iam_role_policy.service]
  tags       = local.common_tags
}

resource "aws_lambda_event_source_mapping" "recognition" {
  event_source_arn                   = aws_sqs_queue.recognition.arn
  function_name                      = aws_lambda_function.recognition.arn
  batch_size                         = 1
  maximum_batching_window_in_seconds = 0
  function_response_types            = ["ReportBatchItemFailures"]
  scaling_config { maximum_concurrency = local.is_production ? 10 : 2 }
}

locals {
  zip_functions = {
    outbox-publisher   = "gatesight_outbox_publisher.handler.handler"
    visit-projector    = "gatesight_visit_projector.handler.handler"
    security-evaluator = "gatesight_security_evaluator.handler.handler"
    heartbeat-monitor  = "gatesight_heartbeat_monitor.handler.handler"
  }
}

resource "aws_lambda_function" "consumer" {
  #checkov:skip=CKV_AWS_115:Production reserves concurrency; development leaves it unreserved because the portfolio account has a ten-concurrency regional quota.
  #checkov:skip=CKV_AWS_117:Consumers access only regional AWS APIs; EventBridge and stream sources do not require a VPC.
  #checkov:skip=CKV_AWS_116:EventBridge targets use retry plus an encrypted target DLQ; the outbox stream retains retries at its source.
  #checkov:skip=CKV_AWS_272:ZIP signing requires environment-owned Signer profiles; deployment provenance is OIDC-bound and artifacts are immutable.
  for_each                       = local.zip_functions
  function_name                  = "${local.prefix}-${each.key}"
  role                           = aws_iam_role.lambda[each.key].arn
  runtime                        = "python3.12"
  handler                        = each.value
  filename                       = "${var.lambda_zip_directory}/${each.key}.zip"
  memory_size                    = 512
  timeout                        = 30
  architectures                  = ["arm64"]
  kms_key_arn                    = aws_kms_key.data.arn
  reserved_concurrent_executions = local.is_production ? (each.key == "heartbeat-monitor" ? 1 : 10) : -1
  tracing_config { mode = "Active" }
  environment {
    variables = {
      GATESIGHT_TABLE_PREFIX            = local.prefix
      GATESIGHT_EVENT_BUS_NAME          = aws_cloudwatch_event_bus.domain.name
      GATESIGHT_SECURITY_TOPIC_ARN      = aws_sns_topic.security.arn
      GATESIGHT_DASHBOARD_URL           = var.dashboard_url
      GATESIGHT_CONFIG_PREFIX           = "/${local.prefix}/recognition"
      GATESIGHT_STALE_HEARTBEAT_SECONDS = "180"
      POWERTOOLS_SERVICE_NAME           = each.key
      POWERTOOLS_METRICS_NAMESPACE      = "GateSight"
      LOG_LEVEL                         = "INFO"
    }
  }
  depends_on = [aws_cloudwatch_log_group.lambda, aws_iam_role_policy.service]
  tags       = local.common_tags
}

resource "aws_lambda_event_source_mapping" "outbox" {
  event_source_arn                   = aws_dynamodb_table.outbox.stream_arn
  function_name                      = aws_lambda_function.consumer["outbox-publisher"].arn
  starting_position                  = "LATEST"
  batch_size                         = 10
  maximum_batching_window_in_seconds = 1
  bisect_batch_on_function_error     = true
  function_response_types            = ["ReportBatchItemFailures"]
}

resource "aws_cloudwatch_event_rule" "consumer" {
  for_each       = toset(["visit-projector", "security-evaluator"])
  name           = "${local.prefix}-${each.key}"
  event_bus_name = aws_cloudwatch_event_bus.domain.name
  event_pattern = jsonencode({
    source      = ["gatesight.recognition"]
    detail-type = ["com.gatesight.plate-recognition.completed.v1"]
  })
  tags = local.common_tags
}

resource "aws_cloudwatch_event_target" "consumer" {
  for_each       = aws_cloudwatch_event_rule.consumer
  rule           = each.value.name
  event_bus_name = aws_cloudwatch_event_bus.domain.name
  arn            = aws_lambda_function.consumer[each.key].arn
  target_id      = each.key
  retry_policy {
    maximum_event_age_in_seconds = 86400
    maximum_retry_attempts       = 185
  }
  dead_letter_config {
    arn = aws_sqs_queue.event_consumer_dlq.arn
  }
}

resource "aws_sqs_queue_policy" "event_consumer_dlq" {
  queue_url = aws_sqs_queue.event_consumer_dlq.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AllowEventBridgeDeadLetters"
      Effect    = "Allow"
      Principal = { Service = "events.amazonaws.com" }
      Action    = "sqs:SendMessage"
      Resource  = aws_sqs_queue.event_consumer_dlq.arn
      Condition = {
        ArnEquals = {
          "aws:SourceArn" = concat(
            [for rule in aws_cloudwatch_event_rule.consumer : rule.arn],
            [aws_cloudwatch_event_rule.heartbeat_monitor.arn]
          )
        }
      }
    }]
  })
}

resource "aws_lambda_permission" "eventbridge" {
  for_each      = aws_cloudwatch_event_rule.consumer
  statement_id  = "AllowEventBridge-${each.key}"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.consumer[each.key].function_name
  principal     = "events.amazonaws.com"
  source_arn    = each.value.arn
}

resource "aws_cloudwatch_event_rule" "heartbeat_monitor" {
  name                = "${local.prefix}-heartbeat-monitor"
  schedule_expression = "rate(5 minutes)"
  tags                = local.common_tags
}

resource "aws_cloudwatch_event_target" "heartbeat_monitor" {
  rule      = aws_cloudwatch_event_rule.heartbeat_monitor.name
  arn       = aws_lambda_function.consumer["heartbeat-monitor"].arn
  target_id = "heartbeat-monitor"
  retry_policy {
    maximum_event_age_in_seconds = 3600
    maximum_retry_attempts       = 10
  }
  dead_letter_config {
    arn = aws_sqs_queue.event_consumer_dlq.arn
  }
}

resource "aws_lambda_permission" "heartbeat_monitor" {
  statement_id  = "AllowEventBridgeHeartbeatMonitor"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.consumer["heartbeat-monitor"].function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.heartbeat_monitor.arn
}
