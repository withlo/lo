; From Zed's Elixir extension (https://github.com/zed-extensions/elixir), languages/elixir/injections.scm
; at f02229c005cfee90f54be99ec1943d455049668e. Copyright 2022-2024 Zed Industries, Inc. Apache-2.0.
; Changed for Lo: a pattern whose predicate names a capture only some of its alternatives have is
; split, one pattern for the alternatives with it and one for those without, since web-tree-sitter
; fails a predicate on a capture a match lacks, where tree-sitter's own library passes it.

; Markdown documentation attributes
(unary_operator
  operator: "@"
  operand: (call
    target: (identifier) @_identifier
    (arguments
      [
        (string
          (quoted_content) @injection.content)
        (keywords
          (pair
            key: ((keyword) @_keyword
              (#eq? @_keyword "deprecated: "))
            value: (string
              (quoted_content) @injection.content)))
      ]))
  (#any-of? @_identifier "deprecated" "moduledoc" "typedoc" "shortdoc" "doc")
  (#set! injection.language "markdown"))

(unary_operator
  operator: "@"
  operand: (call
    target: (identifier) @_identifier
    (arguments
      [
        (sigil
          (sigil_name) @_sigil_name
          (quoted_content) @injection.content)
        (keywords
          (pair
            key: ((keyword) @_keyword
              (#eq? @_keyword "deprecated: "))
            value: (sigil
              (sigil_name) @_sigil_name
              (quoted_content) @injection.content)))
      ]))
  (#any-of? @_sigil_name "S" "s")
  (#any-of? @_identifier "deprecated" "moduledoc" "typedoc" "shortdoc" "doc")
  (#set! injection.language "markdown"))

; Regex sigils
((sigil
  (sigil_name) @_sigil_name
  (quoted_content) @injection.content)
  (#any-of? @_sigil_name "R" "r")
  (#set! injection.language "regex")
  (#set! injection.combined))

; Phoenix HEEx template sigil
((sigil
  (sigil_name) @_sigil_name
  (quoted_content) @injection.content)
  (#eq? @_sigil_name "H")
  (#set! injection.language "heex"))

; Hologram HOLO template sigil
((sigil
  (sigil_name) @_sigil_name
  (quoted_content) @injection.content)
  (#eq? @_sigil_name "HOLO")
  (#set! injection.language "holo"))

; Jason sigils
((sigil
  (sigil_name) @_sigil_name
  (quoted_content) @injection.content)
  (#any-of? @_sigil_name "J" "j")
  (#set! injection.language "json")
  (#set! injection.combined))

; Phoenix LiveView component macros
(call
  target: (identifier) @_identifier
  (arguments
    (atom)
    (atom)?
    (keywords
      (pair
        key: ((keyword) @_keyword
          (#eq? @_keyword "doc: "))
        value: (string
          (quoted_content) @injection.content))))
  (#any-of? @_identifier "attr" "slot")
  (#set! injection.language "markdown"))

(call
  target: (identifier) @_identifier
  (arguments
    (atom)
    (atom)?
    (keywords
      (pair
        key: ((keyword) @_keyword
          (#eq? @_keyword "doc: "))
        value: (sigil
          (sigil_name) @_sigil_name
          (quoted_content) @injection.content))))
  (#any-of? @_sigil_name "S" "s")
  (#any-of? @_identifier "attr" "slot")
  (#set! injection.language "markdown"))

; Comment parsing languages support
((comment) @injection.content
  (#set! injection.language "comment"))
