; From Zed's Ruby extension (https://github.com/zed-extensions/ruby), languages/ruby/injections.scm
; at 13ebcebfad082ec3942ea23952d6a97437ee11a9. Copyright 2022 - 2024 Zed Industries, Inc. Apache-2.0.

(heredoc_body
  (heredoc_content) @content
  (heredoc_end) @language
  (#downcase! @language))

((regex
  (string_content) @content)
  (#set! "language" "regex"))

; RBS Inline: #: syntax
((comment) @content
  (#match? @content "^\\s*#:")
  (#set! injection.language "rbs"))

; RBS Inline: # @rbs syntax
((comment) @content
  (#match? @content "^\\s*#\\s*@rbs")
  (#set! injection.language "rbs"))

; RBS Inline: continuation lines (e.g., "#| param: Type" or "#    | (?Regexp?) -> void")
; Note: These will parse with errors since they're not complete RBS on their own,
; but types within them will still get highlighted
((comment) @content
  (#match? @content "^\\s*#\\s*\\|")
  (#set! injection.language "rbs"))

((comment) @content
  (#set! injection.language "comment"))
