; Lo's tags for Terraform, whose grammar, HCL's, has none: the blocks a configuration names, and
; the attributes it reads through them, such as `var.region` and `aws_s3_bucket.logs.arn`.

; Variables and outputs: `variable "region" {`.
(config_file
  (body
    (block
      (identifier) @_kind
      .
      (string_lit
        (template_literal) @name)
      .
      (block_start)
      (#any-of? @_kind "variable" "output")) @definition.variable))

; Modules: `module "network" {`.
(config_file
  (body
    (block
      (identifier) @_kind
      .
      (string_lit
        (template_literal) @name)
      .
      (block_start)
      (#eq? @_kind "module")) @definition.module))

; Resources and data sources, by their own names: `resource "aws_s3_bucket" "logs" {`.
(config_file
  (body
    (block
      (identifier) @_kind
      .
      (string_lit)
      .
      (string_lit
        (template_literal) @name)
      .
      (block_start)
      (#any-of? @_kind "resource" "data")) @definition.class))

; Locals: `locals { name = "logs" }`.
(config_file
  (body
    (block
      (identifier) @_kind
      (body
        (attribute
          (identifier) @name) @definition.constant)
      (#eq? @_kind "locals"))))

; What's read through a dot: `var.region`, `local.name`, `aws_s3_bucket.logs.arn`.
(get_attr
  (identifier) @name) @reference.field
