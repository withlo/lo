; From Zed's PHP extension (https://github.com/zed-extensions/php), languages/php/injections.scm
; at 6768398bea34ea3b2ad590ac8081eb6c1ce6bf29. Copyright 2022 - 2025 Zed Industries, Inc. Apache-2.0.

((text) @injection.content
  (#set! injection.language "html")
  (#set! injection.combined))

((comment) @injection.content
  (#match? @injection.content "^/\\*\\*[^*]")
  (#set! injection.language "phpdoc"))

((comment) @injection.content
  (#set! injection.language "comment"))

((heredoc_body)
  (heredoc_end) @injection.language) @injection.content

((nowdoc_body)
  (heredoc_end) @injection.language) @injection.content
