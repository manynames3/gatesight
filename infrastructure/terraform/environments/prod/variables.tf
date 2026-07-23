variable "aws_region" {
  type    = string
  default = "us-east-1"
}
variable "worker_image_uri" {
  type = string
}
variable "web_origins" {
  type = list(string)
}
variable "dashboard_url" {
  type = string
}
variable "cognito_domain_prefix" {
  type = string
}
variable "budget_email" {
  type = string
}
variable "notification_email" {
  type    = string
  default = ""
}
