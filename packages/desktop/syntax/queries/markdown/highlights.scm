; From tree-sitter-markdown (https://github.com/zed-industries/tree-sitter-markdown), tree-sitter-markdown/queries/highlights.scm
; at b596e737286780d7bfa9fcddceaeeb754574b352. Copyright (c) 2021 Matthias Deiml. MIT.
; Changed for Lo: a fenced code block isn't `@text.literal` as a whole, which Lo can't take away
; from its code with `@none` as the grammar does, so the code takes the style of its own language.
; Its first line says it's from nvim-treesitter (https://github.com/nvim-treesitter/nvim-treesitter),
; which is under the Apache License 2.0.

;From nvim-treesitter/nvim-treesitter
(atx_heading (inline) @text.title)
(setext_heading (paragraph) @text.title)

[
  (atx_h1_marker)
  (atx_h2_marker)
  (atx_h3_marker)
  (atx_h4_marker)
  (atx_h5_marker)
  (atx_h6_marker)
  (setext_h1_underline)
  (setext_h2_underline)
] @punctuation.special

[
  (link_title)
  (indented_code_block)
] @text.literal

[
  (fenced_code_block_delimiter)
] @punctuation.delimiter

(code_fence_content) @none

[
  (link_destination)
] @text.uri

[
  (link_label)
] @text.reference

[
  (list_marker_plus)
  (list_marker_minus)
  (list_marker_star)
  (list_marker_dot)
  (list_marker_parenthesis)
  (thematic_break)
] @punctuation.special

[
  (block_continuation)
  (block_quote_marker)
] @punctuation.special

[
  (backslash_escape)
] @string.escape
