; From tree-sitter-json (https://github.com/tree-sitter/tree-sitter-json), queries/highlights.scm
; at ee35a6ebefcef0c5c416c0d1ccec7370cfca5a24. Copyright (c) 2014 Max Brunsfeld. MIT.
; Changed for Lo: the string pattern comes before the key pattern, so that the key wins, as Lo
; lets the later pattern win.

(string) @string

(pair
  key: (_) @string.special.key)

(number) @number

[
  (null)
  (true)
  (false)
] @constant.builtin

(escape_sequence) @escape

(comment) @comment
