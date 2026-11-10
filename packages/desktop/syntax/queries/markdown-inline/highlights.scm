; From Zed (https://github.com/zed-industries/zed), crates/grammars/src/markdown-inline/highlights.scm
; at c84af5b99cbc366d675064e52b23664a015b6e35. Copyright Zed Industries, Inc. GPL-3.0-or-later.

(emphasis) @emphasis.markup

(strong_emphasis) @emphasis.strong.markup

(code_span) @text.literal.markup

(strikethrough) @strikethrough.markup

[
  (inline_link)
  (shortcut_link)
  (collapsed_reference_link)
  (full_reference_link)
  (image)
  (link_text)
  (link_label)
] @link_text.markup

(inline_link
  [
    "("
    ")"
  ] @link_uri.markup)

(image
  [
    "("
    ")"
  ] @link_uri.markup)

[
  (link_destination)
  (uri_autolink)
  (email_autolink)
] @link_uri.markup
