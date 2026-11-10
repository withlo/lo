; From Zed (https://github.com/zed-industries/zed), crates/grammars/src/yaml/highlights.scm
; at c84af5b99cbc366d675064e52b23664a015b6e35. Copyright Zed Industries, Inc. GPL-3.0-or-later.

(boolean_scalar) @boolean

(null_scalar) @constant.builtin

[
  (double_quote_scalar)
  (single_quote_scalar)
  (block_scalar)
  (string_scalar)
] @string

(escape_sequence) @string.escape

[
  (integer_scalar)
  (float_scalar)
] @number

(comment) @comment

[
  (anchor_name)
  (alias_name)
  (tag)
] @type

key: (flow_node
  [
    (plain_scalar
      (string_scalar))
    (double_quote_scalar)
    (single_quote_scalar)
  ] @property)

[
  ","
  "-"
  ":"
  ">"
  "?"
  "|"
] @punctuation.delimiter

[
  "["
  "]"
  "{"
  "}"
] @punctuation.bracket

[
  "*"
  "&"
  "---"
  "..."
] @punctuation.special
