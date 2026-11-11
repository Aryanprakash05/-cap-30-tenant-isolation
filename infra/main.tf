terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

# ─── Existing resources (created by hand before Terraform) ─────────────────
# The bucket and IAM user already exist. Import them on first use so
# `terraform apply` manages them instead of failing on the duplicate name:
#   terraform import aws_s3_bucket.tenant_data cap-30-tenant-data-aryan
#   terraform import aws_iam_user.snowflake_stage capstone-snowflake-user
# (Import blocks below do the same thing declaratively, Terraform >= 1.5.)
import {
  to = aws_s3_bucket.tenant_data
  id = "cap-30-tenant-data-aryan"
}

import {
  to = aws_iam_user.snowflake_stage
  id = "capstone-snowflake-user"
}

# NOTE: the policy in this file is named cap30-snowflake-stage-read-policy,
# while the existing attached policy is capstone-snowflake-s3-read. Apply
# creates the new policy and attaches it alongside the old one (same
# permissions); detach the old one in the console once verified.

# ─── Variables ────────────────────────────────────────────────────────────────

variable "aws_region" {
  description = "AWS region for the S3 bucket"
  type        = string
  default     = "eu-north-1"
}

variable "bucket_name" {
  description = "S3 bucket name"
  type        = string
  default     = "cap-30-tenant-data-aryan"
}

variable "iam_user_name" {
  description = "IAM user for Snowflake stage access (time-boxed workaround)"
  type        = string
  default     = "capstone-snowflake-user"
}

# ─── S3 Bucket ────────────────────────────────────────────────────────────────

resource "aws_s3_bucket" "tenant_data" {
  bucket = var.bucket_name

  tags = {
    Project     = "CAP-30"
    Purpose     = "Snowflake stage source — synthetic tenant analytics data"
    Environment = "Demo"
  }
}

resource "aws_s3_bucket_public_access_block" "tenant_data" {
  bucket = aws_s3_bucket.tenant_data.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "tenant_data" {
  bucket = aws_s3_bucket.tenant_data.id
  versioning_configuration {
    status = "Enabled"
  }
}

# ─── IAM Policy — least privilege, scoped to cap30/ prefix ───────────────────
# NOTE: This is the time-boxed workaround because the organization's RCP/SCP
# blocks the storage integration approach (cross-account IAM role trust).
# Target architecture: Snowflake storage integration with IAM role trust.
# See docs/05_runbook.md for the storage integration commands to run once
# the org policy allows it.

resource "aws_iam_policy" "snowflake_stage_read" {
  name        = "cap30-snowflake-stage-read-policy"
  description = "Read-only access to cap30/ prefix in the tenant data bucket. Used by Snowflake stage IAM user."

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "ListBucketPrefix"
        Effect = "Allow"
        Action = ["s3:ListBucket"]
        Resource = ["arn:aws:s3:::${var.bucket_name}"]
        Condition = {
          StringLike = {
            "s3:prefix" = ["cap30/*"]
          }
        }
      },
      {
        Sid    = "GetObjects"
        Effect = "Allow"
        Action = ["s3:GetObject"]
        Resource = ["arn:aws:s3:::${var.bucket_name}/cap30/*"]
      }
    ]
  })
}

# ─── IAM User (stage access — rotate every 90 days per runbook) ───────────────

resource "aws_iam_user" "snowflake_stage" {
  name = var.iam_user_name
  tags = {
    Project   = "CAP-30"
    RotateBy  = "90 days from creation — see docs/05_runbook.md"
  }
}

resource "aws_iam_user_policy_attachment" "snowflake_stage" {
  user       = aws_iam_user.snowflake_stage.name
  policy_arn = aws_iam_policy.snowflake_stage_read.arn
}

# ─── Outputs ─────────────────────────────────────────────────────────────────

output "bucket_name" {
  value       = aws_s3_bucket.tenant_data.bucket
  description = "S3 bucket name"
}

output "bucket_arn" {
  value       = aws_s3_bucket.tenant_data.arn
  description = "S3 bucket ARN"
}

output "iam_user_arn" {
  value       = aws_iam_user.snowflake_stage.arn
  description = "IAM user ARN — generate access key manually in console after apply"
}

# ─── NOTE: Access Key ─────────────────────────────────────────────────────────
# Do NOT create aws_iam_access_key here — Terraform would store the secret in
# state file (plaintext). Generate the access key manually in the AWS console
# after `terraform apply`, then update the Snowflake stage as per runbook.
