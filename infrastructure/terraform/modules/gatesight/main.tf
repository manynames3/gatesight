data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}

locals {
  prefix          = var.name
  is_production   = var.environment == "prod"
  table_names     = toset(["facilities", "stations", "captures", "observations", "registrations", "visits", "alerts", "idempotency", "audit"])
  lambda_services = toset(["control-api", "recognition-worker", "outbox-publisher", "visit-projector", "security-evaluator", "heartbeat-monitor"])
  common_tags = {
    Application = "GateSight"
    Environment = var.environment
    ManagedBy   = "Terraform"
  }
}

resource "aws_kms_key" "data" {
  #checkov:skip=CKV2_AWS_64:An explicit account-root policy delegates use to IAM; service roles remain least-privilege in their own policies.
  description             = "${local.prefix} application data"
  enable_key_rotation     = true
  deletion_window_in_days = local.is_production ? 30 : 7
  policy                  = data.aws_iam_policy_document.kms.json
  tags                    = local.common_tags
}

data "aws_iam_policy_document" "kms" {
  #checkov:skip=CKV_AWS_109:This is the standard KMS root-delegation statement, scoped to the current account root principal.
  #checkov:skip=CKV_AWS_111:KMS key policies require Resource "*"; access is constrained to the current account root and delegated IAM roles.
  #checkov:skip=CKV_AWS_356:KMS key policies do not support the key ARN as Resource; the current account root principal is the constraint.
  statement {
    sid       = "EnableAccountIAMPolicies"
    effect    = "Allow"
    actions   = ["kms:*"]
    resources = ["*"]
    principals {
      type        = "AWS"
      identifiers = ["arn:${data.aws_partition.current.partition}:iam::${data.aws_caller_identity.current.account_id}:root"]
    }
  }
}

resource "aws_kms_alias" "data" {
  name          = "alias/${local.prefix}-data"
  target_key_id = aws_kms_key.data.key_id
}

resource "aws_s3_bucket" "captures" {
  #checkov:skip=CKV_AWS_18:Media access is application-audited; server access logs would create a second plate-media-linked retention surface.
  #checkov:skip=CKV_AWS_144:Single-region deployment is an explicit cost/privacy boundary; encrypted backups and PITR protect durable records.
  #checkov:skip=CKV2_AWS_62:Uploads are verified and enqueued only by the authenticated completion API, not by untrusted S3 notifications.
  bucket_prefix = "${local.prefix}-captures-"
  force_destroy = !local.is_production
  tags          = local.common_tags
}

resource "aws_s3_bucket_public_access_block" "captures" {
  bucket                  = aws_s3_bucket.captures.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "captures" {
  bucket = aws_s3_bucket.captures.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "captures" {
  bucket = aws_s3_bucket.captures.id
  rule {
    apply_server_side_encryption_by_default {
      kms_master_key_id = aws_kms_key.data.arn
      sse_algorithm     = "aws:kms"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_versioning" "captures" {
  bucket = aws_s3_bucket.captures.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "captures" {
  bucket = aws_s3_bucket.captures.id
  rule {
    id     = "capture-retention"
    status = "Enabled"
    filter {}
    expiration {
      days = var.raw_media_retention_days
    }
    noncurrent_version_expiration {
      noncurrent_days = 1
    }
    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

resource "aws_s3_bucket_cors_configuration" "captures" {
  bucket = aws_s3_bucket.captures.id
  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["POST"]
    allowed_origins = var.web_origins
    expose_headers  = ["ETag"]
    max_age_seconds = 300
  }
}

resource "aws_s3_bucket_policy" "captures" {
  bucket = aws_s3_bucket.captures.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "DenyInsecureTransport"
      Effect    = "Deny"
      Principal = "*"
      Action    = "s3:*"
      Resource  = [aws_s3_bucket.captures.arn, "${aws_s3_bucket.captures.arn}/*"]
      Condition = { Bool = { "aws:SecureTransport" = "false" } }
    }]
  })
}

resource "aws_sqs_queue" "recognition_dlq" {
  name                      = "${local.prefix}-recognition-dlq"
  message_retention_seconds = 1209600
  kms_master_key_id         = aws_kms_key.data.arn
  tags                      = local.common_tags
}

resource "aws_sqs_queue" "recognition" {
  name                       = "${local.prefix}-recognition"
  visibility_timeout_seconds = 180
  message_retention_seconds  = 345600
  receive_wait_time_seconds  = 20
  kms_master_key_id          = aws_kms_key.data.arn
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.recognition_dlq.arn
    maxReceiveCount     = 4
  })
  tags = local.common_tags
}

resource "aws_sqs_queue_redrive_allow_policy" "recognition" {
  queue_url = aws_sqs_queue.recognition_dlq.id
  redrive_allow_policy = jsonencode({
    redrivePermission = "byQueue"
    sourceQueueArns   = [aws_sqs_queue.recognition.arn]
  })
}

resource "aws_sqs_queue" "event_consumer_dlq" {
  name                       = "${local.prefix}-event-consumer-dlq"
  message_retention_seconds  = 1209600
  sqs_managed_sse_enabled    = true
  visibility_timeout_seconds = 60
  tags                       = local.common_tags
}

resource "aws_ecr_repository" "recognition" {
  name                 = "${local.prefix}-recognition"
  image_tag_mutability = "IMMUTABLE"
  encryption_configuration {
    encryption_type = "KMS"
    kms_key         = aws_kms_key.data.arn
  }
  image_scanning_configuration {
    scan_on_push = true
  }
  tags = local.common_tags
}

resource "aws_ecr_lifecycle_policy" "recognition" {
  repository = aws_ecr_repository.recognition.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Retain the ten newest immutable images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 10
      }
      action = { type = "expire" }
    }]
  })
}

resource "aws_ecr_registry_scanning_configuration" "enhanced" {
  count     = var.enable_ecr_enhanced_scanning ? 1 : 0
  scan_type = "ENHANCED"
  rule {
    scan_frequency = "SCAN_ON_PUSH"
    repository_filter {
      filter      = "${local.prefix}-*"
      filter_type = "WILDCARD"
    }
  }
}

resource "aws_dynamodb_table" "domain" {
  #checkov:skip=CKV_AWS_28:PITR is enabled in production via local.is_production; development intentionally uses disposable tables.
  for_each                    = local.table_names
  name                        = "${local.prefix}-${each.key}"
  billing_mode                = "PAY_PER_REQUEST"
  hash_key                    = "tenantId"
  range_key                   = "recordId"
  deletion_protection_enabled = local.is_production

  attribute {
    name = "tenantId"
    type = "S"
  }
  attribute {
    name = "recordId"
    type = "S"
  }
  attribute {
    name = "facilityId"
    type = "S"
  }
  attribute {
    name = "createdAt"
    type = "S"
  }
  attribute {
    name = "facilityStatus"
    type = "S"
  }
  attribute {
    name = "capturedAt"
    type = "S"
  }
  attribute {
    name = "authorizationScope"
    type = "S"
  }
  attribute {
    name = "normalizedPlate"
    type = "S"
  }
  attribute {
    name = "tenantPlate"
    type = "S"
  }
  attribute {
    name = "facilityOpen"
    type = "S"
  }
  attribute {
    name = "entryAt"
    type = "S"
  }
  attribute {
    name = "occurredAt"
    type = "S"
  }

  global_secondary_index {
    name = "byTenantCreated"
    key_schema {
      attribute_name = "tenantId"
      key_type       = "HASH"
    }
    key_schema {
      attribute_name = "createdAt"
      key_type       = "RANGE"
    }
    projection_type = "ALL"
  }
  global_secondary_index {
    name = "byFacilityCreated"
    key_schema {
      attribute_name = "facilityId"
      key_type       = "HASH"
    }
    key_schema {
      attribute_name = "createdAt"
      key_type       = "RANGE"
    }
    projection_type = "ALL"
  }
  global_secondary_index {
    name = "byFacilityTime"
    key_schema {
      attribute_name = "facilityId"
      key_type       = "HASH"
    }
    key_schema {
      attribute_name = contains(["visits"], each.key) ? "entryAt" : contains(["alerts"], each.key) ? "occurredAt" : "capturedAt"
      key_type       = "RANGE"
    }
    projection_type = "ALL"
  }
  global_secondary_index {
    name = "byFacilityStatus"
    key_schema {
      attribute_name = "facilityStatus"
      key_type       = "HASH"
    }
    key_schema {
      attribute_name = "createdAt"
      key_type       = "RANGE"
    }
    projection_type = "ALL"
  }
  global_secondary_index {
    name = "byFacilityPlate"
    key_schema {
      attribute_name = "authorizationScope"
      key_type       = "HASH"
    }
    key_schema {
      attribute_name = "normalizedPlate"
      key_type       = "RANGE"
    }
    projection_type = "ALL"
  }
  global_secondary_index {
    name = "byPlate"
    key_schema {
      attribute_name = "tenantPlate"
      key_type       = "HASH"
    }
    key_schema {
      attribute_name = "createdAt"
      key_type       = "RANGE"
    }
    projection_type = "ALL"
  }
  global_secondary_index {
    name = "byFacilityOpen"
    key_schema {
      attribute_name = "facilityOpen"
      key_type       = "HASH"
    }
    key_schema {
      attribute_name = "entryAt"
      key_type       = "RANGE"
    }
    projection_type = "ALL"
  }

  ttl {
    attribute_name = "expiresAt"
    enabled        = each.key == "idempotency" || each.key == "captures"
  }
  point_in_time_recovery {
    enabled = local.is_production
  }
  server_side_encryption {
    enabled     = true
    kms_key_arn = aws_kms_key.data.arn
  }
  tags = local.common_tags
}

resource "aws_dynamodb_table" "outbox" {
  #checkov:skip=CKV_AWS_28:PITR is enabled in production via local.is_production; development intentionally uses a disposable outbox.
  name                        = "${local.prefix}-outbox"
  billing_mode                = "PAY_PER_REQUEST"
  hash_key                    = "tenantId"
  range_key                   = "recordId"
  stream_enabled              = true
  stream_view_type            = "NEW_AND_OLD_IMAGES"
  deletion_protection_enabled = local.is_production
  attribute {
    name = "tenantId"
    type = "S"
  }
  attribute {
    name = "recordId"
    type = "S"
  }
  attribute {
    name = "status"
    type = "S"
  }
  attribute {
    name = "createdAt"
    type = "S"
  }
  global_secondary_index {
    name = "byPublishStatus"
    key_schema {
      attribute_name = "status"
      key_type       = "HASH"
    }
    key_schema {
      attribute_name = "createdAt"
      key_type       = "RANGE"
    }
    projection_type = "ALL"
  }
  point_in_time_recovery {
    enabled = local.is_production
  }
  server_side_encryption {
    enabled     = true
    kms_key_arn = aws_kms_key.data.arn
  }
  tags = local.common_tags
}

resource "aws_ssm_parameter" "recognition" {
  for_each = {
    high-confidence       = "0.88"
    review-confidence     = "0.55"
    detector-confidence   = "0.40"
    minimum-good-frames   = "2"
    maximum-edit-distance = "1"
    minimum-plate-pixels  = "72"
    duplicate-window      = "30"
    alert-suppression     = "900"
    overstay-seconds      = "86400"
  }
  name        = "/${local.prefix}/recognition/${each.key}"
  description = "Operational threshold; uncalibrated until labeled evaluation is complete."
  type        = "SecureString"
  key_id      = aws_kms_key.data.arn
  value       = each.value
  tags        = local.common_tags
}

resource "aws_cognito_user_pool" "main" {
  name                     = local.prefix
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]
  mfa_configuration        = local.is_production ? "ON" : "OPTIONAL"
  software_token_mfa_configuration { enabled = true }
  password_policy {
    minimum_length                   = 14
    require_lowercase                = true
    require_numbers                  = true
    require_symbols                  = true
    require_uppercase                = true
    temporary_password_validity_days = 3
  }
  schema {
    name                = "tenant_id"
    attribute_data_type = "String"
    mutable             = true
    required            = false
    string_attribute_constraints {
      min_length = 10
      max_length = 64
    }
  }
  schema {
    name                = "facility_ids"
    attribute_data_type = "String"
    mutable             = true
    required            = false
    string_attribute_constraints {
      min_length = 0
      max_length = 2048
    }
  }
  user_pool_add_ons {
    advanced_security_mode = "ENFORCED"
  }
  deletion_protection = local.is_production ? "ACTIVE" : "INACTIVE"
  tags                = local.common_tags
}

resource "aws_cognito_user_pool_client" "web" {
  name                                 = "${local.prefix}-web"
  user_pool_id                         = aws_cognito_user_pool.main.id
  generate_secret                      = false
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email", "profile"]
  callback_urls                        = [for origin in var.web_origins : "${origin}/auth/callback"]
  logout_urls                          = [for origin in var.web_origins : "${origin}/sign-in"]
  supported_identity_providers         = ["COGNITO"]
  prevent_user_existence_errors        = "ENABLED"
  enable_token_revocation              = true
  access_token_validity                = 15
  id_token_validity                    = 15
  refresh_token_validity               = 1
  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }
}

resource "aws_cognito_user_pool_domain" "main" {
  domain       = var.cognito_domain_prefix
  user_pool_id = aws_cognito_user_pool.main.id
}

resource "aws_cognito_user_group" "roles" {
  for_each     = toset(["ADMIN", "SECURITY", "OPERATOR", "VIEWER"])
  name         = each.key
  user_pool_id = aws_cognito_user_pool.main.id
  description  = "GateSight ${lower(each.key)} role"
}

resource "aws_cloudwatch_event_bus" "domain" {
  name = local.prefix
  tags = local.common_tags
}

resource "aws_sns_topic" "security" {
  name              = "${local.prefix}-security"
  kms_master_key_id = aws_kms_key.data.id
  tags              = local.common_tags
}

resource "aws_sns_topic_subscription" "security_email" {
  count     = var.notification_email == "" ? 0 : 1
  topic_arn = aws_sns_topic.security.arn
  protocol  = "email"
  endpoint  = var.notification_email
}
