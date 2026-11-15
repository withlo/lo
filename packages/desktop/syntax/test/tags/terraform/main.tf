variable "region" {
  type    = string
  default = "us-east-1"
}

locals {
  name = "logs-${var.region}"
  tags = { team = "data" }
}

resource "aws_s3_bucket" "logs" {
  bucket = local.name
  tags   = local.tags
}

data "aws_iam_policy_document" "read" {
  statement {
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.logs.arn}/*"]
  }
}

module "network" {
  source = "./modules/network"
  region = var.region
}

output "bucket" {
  value = aws_s3_bucket.logs.id
}

output "vpc" {
  value = module.network.vpc_id
}
