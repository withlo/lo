; From Zed's Kotlin extension (https://github.com/zed-extensions/kotlin), languages/kotlin/injections.scm
; at e94974ea06f6494f003efc3161691a59ea1b3300. Copyright (c) 2024 Evren Sen. MIT.

([
  (line_comment)
  (multiline_comment)
] @content
  (#set! "language" "comment"))
