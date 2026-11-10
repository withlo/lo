; From Zed (https://github.com/zed-industries/zed), crates/grammars/src/markdown-inline/injections.scm
; at c84af5b99cbc366d675064e52b23664a015b6e35. Copyright Zed Industries, Inc. GPL-3.0-or-later.

((html_tag) @injection.content
  (#set! injection.language "html")
  (#set! injection.combined))

((latex_block) @injection.content
  (#set! injection.language "latex"))
