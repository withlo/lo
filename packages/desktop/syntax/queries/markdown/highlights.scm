; From Zed (https://github.com/zed-industries/zed), crates/grammars/src/markdown/highlights.scm
; at c84af5b99cbc366d675064e52b23664a015b6e35. Copyright Zed Industries, Inc. GPL-3.0-or-later.

[
  (paragraph)
  (indented_code_block)
  (pipe_table)
] @text

[
  (atx_heading)
  (setext_heading)
  (thematic_break)
] @title.markup

(setext_heading
  (paragraph) @title.markup)

[
  (list_marker_plus)
  (list_marker_minus)
  (list_marker_star)
  (list_marker_dot)
  (list_marker_parenthesis)
] @punctuation.list_marker.markup

[
  (block_quote_marker)
  (block_continuation)
] @punctuation.markup

(pipe_table_header
  "|" @punctuation.markup)

(pipe_table_row
  "|" @punctuation.markup)

(pipe_table_delimiter_row
  "|" @punctuation.markup)

(pipe_table_delimiter_cell
  "-" @punctuation.markup)

[
  (fenced_code_block_delimiter)
  (info_string)
] @punctuation.embedded.markup

(link_reference_definition) @link_text.markup

(link_destination) @link_uri.markup
