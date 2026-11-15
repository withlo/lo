; From Zed's Java extension (https://github.com/zed-extensions/java), languages/java/injections.scm
; at 2facaa7c4038d0b2dc8204e4b44b7a7c81405564. Copyright the Java extension contributors. Apache-2.0.

([
  (block_comment)
  (line_comment)
] @injection.content
  (#set! injection.language "comment"))

((block_comment) @injection.content
  (#lua-match? @injection.content "/[*][!<*][^a-zA-Z]")
  (#set! injection.language "doxygen"))

((method_invocation
  name: (identifier) @_method
  arguments: (argument_list
    .
    (string_literal
      .
      (_) @injection.content)))
  (#any-of? @_method "format" "printf")
  (#set! injection.language "printf"))

((method_invocation
  object: (string_literal
    (string_fragment) @injection.content)
  name: (identifier) @_method)
  (#eq? @_method "formatted")
  (#set! injection.language "printf"))
