; From Zed's TOML extension (https://github.com/zed-extensions/toml), languages/toml/highlights.scm
; at 8e18e5045841f0f265f9c8b89f138c7f7dd09e2e. Copyright 2022-2025 Zed Industries, Inc. Apache-2.0.

; Properties
;-----------
(bare_key) @property

(quoted_key) @property

; Literals
;---------
(boolean) @constant

(comment) @comment

(integer) @number

(float) @number

(string) @string

(escape_sequence) @string.escape

(offset_date_time) @string.special

(local_date_time) @string.special

(local_date) @string.special

(local_time) @string.special

; Punctuation
;------------
[
  "."
  ","
] @punctuation.delimiter

"=" @operator

[
  "["
  "]"
  "[["
  "]]"
  "{"
  "}"
] @punctuation.bracket
