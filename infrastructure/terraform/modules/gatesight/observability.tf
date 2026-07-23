resource "aws_cloudwatch_metric_alarm" "dlq" {
  alarm_name          = "${local.prefix}-recognition-dlq"
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  period              = 60
  statistic           = "Maximum"
  threshold           = 0
  treat_missing_data  = "notBreaching"
  dimensions          = { QueueName = aws_sqs_queue.recognition_dlq.name }
  alarm_actions       = [aws_sns_topic.security.arn]
  tags                = local.common_tags
}

resource "aws_cloudwatch_metric_alarm" "queue_age" {
  alarm_name          = "${local.prefix}-recognition-queue-age"
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateAgeOfOldestMessage"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  period              = 60
  statistic           = "Maximum"
  threshold           = 300
  treat_missing_data  = "notBreaching"
  dimensions          = { QueueName = aws_sqs_queue.recognition.name }
  alarm_actions       = [aws_sns_topic.security.arn]
  tags                = local.common_tags
}

resource "aws_cloudwatch_metric_alarm" "event_consumer_dlq" {
  alarm_name          = "${local.prefix}-event-consumer-dlq"
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  period              = 60
  statistic           = "Maximum"
  threshold           = 0
  treat_missing_data  = "notBreaching"
  dimensions          = { QueueName = aws_sqs_queue.event_consumer_dlq.name }
  alarm_actions       = [aws_sns_topic.security.arn]
  tags                = local.common_tags
}

resource "aws_cloudwatch_metric_alarm" "lambda_errors" {
  for_each            = local.lambda_services
  alarm_name          = "${local.prefix}-${each.key}-errors"
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  period              = 300
  statistic           = "Sum"
  threshold           = 0
  treat_missing_data  = "notBreaching"
  dimensions          = { FunctionName = "${local.prefix}-${each.key}" }
  alarm_actions       = [aws_sns_topic.security.arn]
  tags                = local.common_tags
}

resource "aws_cloudwatch_metric_alarm" "lambda_throttles" {
  for_each            = local.lambda_services
  alarm_name          = "${local.prefix}-${each.key}-throttles"
  namespace           = "AWS/Lambda"
  metric_name         = "Throttles"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  period              = 300
  statistic           = "Sum"
  threshold           = 0
  treat_missing_data  = "notBreaching"
  dimensions          = { FunctionName = "${local.prefix}-${each.key}" }
  alarm_actions       = [aws_sns_topic.security.arn]
  tags                = local.common_tags
}

resource "aws_cloudwatch_metric_alarm" "worker_duration" {
  alarm_name          = "${local.prefix}-recognition-duration"
  namespace           = "AWS/Lambda"
  metric_name         = "Duration"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  period              = 300
  extended_statistic  = "p95"
  threshold           = 90000
  treat_missing_data  = "notBreaching"
  dimensions          = { FunctionName = aws_lambda_function.recognition.function_name }
  alarm_actions       = [aws_sns_topic.security.arn]
  tags                = local.common_tags
}

resource "aws_cloudwatch_metric_alarm" "api_5xx" {
  alarm_name          = "${local.prefix}-api-5xx"
  namespace           = "AWS/ApiGateway"
  metric_name         = "5xx"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  period              = 300
  statistic           = "Sum"
  threshold           = 2
  treat_missing_data  = "notBreaching"
  dimensions          = { ApiId = aws_apigatewayv2_api.main.id }
  alarm_actions       = [aws_sns_topic.security.arn]
  tags                = local.common_tags
}

resource "aws_cloudwatch_metric_alarm" "outbox_backlog" {
  alarm_name          = "${local.prefix}-outbox-backlog"
  namespace           = "AWS/Lambda"
  metric_name         = "IteratorAge"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  period              = 300
  statistic           = "Maximum"
  threshold           = 120000
  treat_missing_data  = "notBreaching"
  dimensions          = { FunctionName = aws_lambda_function.consumer["outbox-publisher"].function_name }
  alarm_actions       = [aws_sns_topic.security.arn]
  tags                = local.common_tags
}

resource "aws_cloudwatch_metric_alarm" "stale_camera_stations" {
  alarm_name          = "${local.prefix}-stale-camera-stations"
  namespace           = "GateSight"
  metric_name         = "StaleCameraStations"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  period              = 300
  statistic           = "Maximum"
  threshold           = 0
  treat_missing_data  = "breaching"
  dimensions          = { service = "heartbeat-monitor" }
  alarm_actions       = [aws_sns_topic.security.arn]
  tags                = local.common_tags
}

resource "aws_cloudwatch_dashboard" "operations" {
  dashboard_name = "${local.prefix}-operations"
  dashboard_body = jsonencode({
    widgets = [
      {
        type       = "text", x = 0, y = 0, width = 24, height = 2,
        properties = { markdown = "# GateSight operational flow\nNo plate or image data is included." }
      },
      {
        type = "metric", x = 0, y = 2, width = 12, height = 6,
        properties = {
          title  = "Recognition queue"
          region = var.aws_region
          metrics = [
            ["AWS/SQS", "ApproximateNumberOfMessagesVisible", "QueueName", aws_sqs_queue.recognition.name],
            [".", "ApproximateAgeOfOldestMessage", ".", "."],
            [".", "ApproximateNumberOfMessagesVisible", "QueueName", aws_sqs_queue.recognition_dlq.name]
          ]
        }
      },
      {
        type = "metric", x = 12, y = 2, width = 12, height = 6,
        properties = {
          title  = "Recognition worker"
          region = var.aws_region
          metrics = [
            ["AWS/Lambda", "Invocations", "FunctionName", aws_lambda_function.recognition.function_name],
            [".", "Errors", ".", "."],
            [".", "Duration", ".", ".", { stat = "p95" }],
            ["GateSight", "Recognized", "service", "recognition-worker"],
            [".", "NeedsReview", ".", "."],
            [".", "NoPlate", ".", "."]
          ]
        }
      },
      {
        type = "metric", x = 0, y = 8, width = 24, height = 6,
        properties = {
          title  = "API, outbox, visits, alerts"
          region = var.aws_region
          metrics = [
            ["AWS/ApiGateway", "Count", "ApiId", aws_apigatewayv2_api.main.id],
            [".", "5xx", ".", "."],
            ["AWS/Lambda", "IteratorAge", "FunctionName", aws_lambda_function.consumer["outbox-publisher"].function_name],
            ["GateSight", "VisitProjectionEvents", "service", "visit-projector"],
            [".", "SecurityAlertsCreated", "service", "security-evaluator"],
            [".", "AlertDeliveryFailures", ".", "."],
            [".", "StaleCameraStations", "service", "heartbeat-monitor"]
          ]
        }
      }
    ]
  })
}

resource "aws_budgets_budget" "monthly" {
  name         = "${local.prefix}-monthly"
  budget_type  = "COST"
  limit_amount = tostring(var.monthly_budget_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"
  cost_filter {
    name   = "TagKeyValue"
    values = ["user:Application$GateSight"]
  }
  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.budget_email]
  }
  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.budget_email]
  }
}
