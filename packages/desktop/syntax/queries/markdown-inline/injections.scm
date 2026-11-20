; From tree-sitter-markdown (https://github.com/zed-industries/tree-sitter-markdown), tree-sitter-markdown-inline/queries/injections.scm
; at b596e737286780d7bfa9fcddceaeeb754574b352. Copyright (c) 2021 Matthias Deiml. MIT.

((html_tag) @injection.content (#set! injection.language "html"))
((latex_block) @injection.content (#set! injection.language "latex"))
