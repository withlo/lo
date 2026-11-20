; From tree-sitter-rust (https://github.com/tree-sitter/tree-sitter-rust), queries/injections.scm
; at 77a3747266f4d621d0757825e6b11edcbf991ca5. Copyright (c) 2017 Maxim Sokolov. MIT.

((macro_invocation
  (token_tree) @injection.content)
 (#set! injection.language "rust")
 (#set! injection.include-children))

((macro_rule
  (token_tree) @injection.content)
 (#set! injection.language "rust")
 (#set! injection.include-children))
