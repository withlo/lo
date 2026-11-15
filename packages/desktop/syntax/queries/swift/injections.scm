; From Zed's Swift extension (https://github.com/zed-extensions/swift), languages/swift/injections.scm
; at 302c7978f1bc3d512960531ce11000ca333d5268. Copyright the Swift extension authors. Apache-2.0.

; Parse regex syntax within regex literals
((regex_literal) @injection.content
  (#set! injection.language "regex"))

([
  (comment)
  (multiline_comment)
] @injection.content
  (#set! injection.language "comment"))
