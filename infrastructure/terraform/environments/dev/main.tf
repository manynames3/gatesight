module "gatesight" {
  source                   = "../../modules/gatesight"
  name                     = "gatesight-dev"
  environment              = "dev"
  aws_region               = var.aws_region
  worker_image_uri         = var.worker_image_uri
  lambda_zip_directory     = "${path.root}/../../../../build/lambda"
  web_origins              = var.web_origins
  dashboard_url            = var.dashboard_url
  cognito_domain_prefix    = var.cognito_domain_prefix
  budget_email             = var.budget_email
  notification_email       = var.notification_email
  monthly_budget_usd       = 30
  raw_media_retention_days = 1
  log_retention_days       = 14
}
