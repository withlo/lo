; From Zed (https://github.com/zed-industries/zed), extensions/html/languages/html/injections.scm
; at c84af5b99cbc366d675064e52b23664a015b6e35. Copyright 2022 - 2025 Zed Industries, Inc. Apache-2.0.

((comment) @injection.content
  (#set! injection.language "comment"))

(script_element
  (raw_text) @injection.content
  (#set! injection.language "javascript"))

(style_element
  (raw_text) @injection.content
  (#set! injection.language "css"))

(attribute
  (attribute_name) @_attribute_name
  (#match? @_attribute_name "^style$")
  (quoted_attribute_value
    (attribute_value) @injection.content)
  (#set! injection.language "css"))

(attribute
  (attribute_name) @_attribute_name
  (#match? @_attribute_name "^on[a-z]+$")
  (quoted_attribute_value
    (attribute_value) @injection.content)
  (#set! injection.language "javascript"))
