; From Zed (https://github.com/zed-industries/zed), crates/grammars/src/json/highlights.scm
; at c84af5b99cbc366d675064e52b23664a015b6e35. Copyright Zed Industries, Inc. GPL-3.0-or-later.

(comment) @comment

(string) @string

(escape_sequence) @string.escape

(pair
  key: (string) @property.json_key)

(number) @number

[
  (true)
  (false)
] @boolean

(null) @constant.builtin

[
  ","
  ":"
] @punctuation.delimiter

[
  "{"
  "}"
  "["
  "]"
] @punctuation.bracket
