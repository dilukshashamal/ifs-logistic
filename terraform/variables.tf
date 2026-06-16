variable "aws_region" {
  type        = string
  description = "Target AWS region for resources"
  default     = "us-east-1"
}

variable "environment" {
  type        = string
  description = "Deployment environment name"
  default     = "sandbox"
}

variable "db_username" {
  type        = string
  description = "Master username for PostgreSQL database instance"
  default     = "dbadmin"
}

variable "db_password" {
  type        = string
  description = "Master password for PostgreSQL database instance"
  sensitive   = true
  default     = "LogiSimPassword123!"
}

variable "ecr_repository_url" {
  type        = string
  description = "Docker ECR repository registry URL for the backend image"
  default     = "123456789012.dkr.ecr.us-east-1.amazonaws.com/logisim-backend"
}

variable "monthly_billing_threshold_usd" {
  type        = number
  description = "Maximum monthly AWS budget threshold limit in USD"
  default     = 5.0
}

variable "db_instance_class" {
  type        = string
  description = "RDS database instance instance class size"
  default     = "db.t3.micro"
}

variable "alert_email_address" {
  type        = string
  description = "Destination email address for billing alarms and anomalies"
  default     = "dilukshashamal2001@gmail.com"
}
