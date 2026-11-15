; From Zed (https://github.com/zed-industries/zed), crates/grammars/src/python/injections.scm
; at c84af5b99cbc366d675064e52b23664a015b6e35. Copyright Zed Industries, Inc. GPL-3.0-or-later.

((comment) @injection.content
  (#set! injection.language "comment"))

; SQL -----------------------------------------------------------------------------
([
  ; function calls
  (call
    [
      (attribute
        attribute: (identifier))
      (identifier)
    ]
    arguments: (argument_list
      (comment) @_comment
      (string
        (string_content) @injection.content) @injection.host))
  ; string variables
  ((comment) @_comment
    .
    (expression_statement
      (assignment
        right: (string
          (string_content) @injection.content) @injection.host)))
]
  (#match? @_comment "^(#|#\\s+)(?i:sql)\\s*$")
  (#set! injection.language "sql"))
