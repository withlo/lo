; From Zed (https://github.com/zed-industries/zed), extensions/html/languages/html/highlights.scm
; at c84af5b99cbc366d675064e52b23664a015b6e35. Copyright 2022 - 2025 Zed Industries, Inc. Apache-2.0.

(tag_name) @tag

(doctype) @tag.doctype

(attribute_name) @attribute

[
  "\""
  "'"
  (attribute_value)
] @string

(comment) @comment

(entity) @string.special

"=" @punctuation.delimiter.html

[
  "<"
  ">"
  "<!"
  "</"
  "/>"
] @punctuation.bracket.html
