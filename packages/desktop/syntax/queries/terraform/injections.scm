; From Zed's Terraform extension (https://github.com/zed-extensions/terraform), languages/terraform/injections.scm
; at 99bcfa52db879b6f71b803307a9640e04e336623. Copyright 2022-2024 Zed Industries, Inc. Apache-2.0.

; https://github.com/nvim-treesitter/nvim-treesitter/blob/ce4adf11cfe36fc5b0e5bcdce0c7c6e8fbc9798a/queries/hcl/injections.scm
(heredoc_template
  (template_literal) @injection.content
  (heredoc_identifier) @injection.language
  (#downcase! @injection.language))

; https://github.com/nvim-treesitter/nvim-treesitter/blob/ce4adf11cfe36fc5b0e5bcdce0c7c6e8fbc9798a/queries/terraform/injections.scm
; inherits: hcl

((comment) @injection.content
  (#set! injection.language "comment"))
