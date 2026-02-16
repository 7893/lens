variable "account_id" {
  description = "Cloudflare Account ID"
  type        = string
}

variable "environment" {
  description = "Environment (dev, prod)"
  type        = string
  default     = "prod"
}
