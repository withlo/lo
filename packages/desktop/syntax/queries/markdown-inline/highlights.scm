; From tree-sitter-markdown (https://github.com/zed-industries/tree-sitter-markdown), tree-sitter-markdown-inline/queries/highlights.scm
; at b596e737286780d7bfa9fcddceaeeb754574b352. Copyright (c) 2021 Matthias Deiml. MIT.
; Its first line says it's from nvim-treesitter (https://github.com/nvim-treesitter/nvim-treesitter),
; which is under the Apache License 2.0.

;; From nvim-treesitter/nvim-treesitter
[
  (code_span)
  (link_title)
] @text.literal

[
  (emphasis_delimiter)
  (code_span_delimiter)
] @punctuation.delimiter

(emphasis) @text.emphasis

(strong_emphasis) @text.strong

[
  (link_destination)
  (uri_autolink)
] @text.uri

[
  (link_label)
  (link_text)
  (image_description)
] @text.reference

[
  (backslash_escape)
  (hard_line_break)
] @string.escape

(image ["!" "[" "]" "(" ")"] @punctuation.delimiter)
(inline_link ["[" "]" "(" ")"] @punctuation.delimiter)
(shortcut_link ["[" "]"] @punctuation.delimiter)

; NOTE: extension not enabled by default
; (wiki_link ["[" "|" "]"] @punctuation.delimiter)
