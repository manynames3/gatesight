variable "name" {
  type        = string
  description = "Environment-qualified application name."
}

variable "environment" {
  type        = string
  description = "Deployment environment."
  validation {
    condition     = contains(["dev", "prod"], var.environment)
    error_message = "environment must be dev or prod"
  }
}

variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "worker_image_uri" {
  type        = string
  description = "Immutable ECR recognition image URI, preferably by digest."
  validation {
    condition     = can(regex("@sha256:[a-f0-9]{64}$", var.worker_image_uri))
    error_message = "worker_image_uri must use an immutable sha256 digest"
  }
}

variable "lambda_zip_directory" {
  type        = string
  description = "Directory containing control-api.zip and event-consumer ZIPs."
}

variable "web_origins" {
  type        = list(string)
  description = "Allowed Cloudflare Pages production/preview origins."
}

variable "dashboard_url" {
  type        = string
  description = "Authenticated GateSight dashboard origin."
}

variable "cognito_domain_prefix" {
  type        = string
  description = "Globally unique Cognito Hosted UI domain prefix."
}

variable "notification_email" {
  type        = string
  default     = ""
  description = "Optional SNS subscription email; confirmation is required."
}

variable "budget_email" {
  type        = string
  description = "Email address for AWS Budget alerts."
}

variable "monthly_budget_usd" {
  type    = number
  default = 50
}

variable "raw_media_retention_days" {
  type    = number
  default = 30
}

variable "log_retention_days" {
  type    = number
  default = 30
}

variable "enable_ecr_enhanced_scanning" {
  type        = bool
  default     = false
  description = "Account-wide setting; enable only when delegated registry governance permits it."
}
