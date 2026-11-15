; Lo's additions to tree-sitter-elixir's tags, for what they leave out. They come after the
; grammar's own, so where both define a name, or both use it, the grammar's tag wins.

; Module attributes that hold a value, `@max_size 10`, named without their `@`. Those Elixir
; reads itself, such as `@doc` and `@spec`, aren't definitions.
(unary_operator
  operator: "@"
  operand: (call
    target: (identifier) @name
    (arguments)) @definition.constant
  (#not-any-of? @name
    "doc" "moduledoc" "typedoc" "spec" "type" "typep" "opaque" "callback" "macrocallback" "impl"
    "behaviour" "derive" "enforce_keys" "dialyzer" "compile" "deprecated" "since" "on_load"
    "external_resource" "after_compile" "before_compile"))

; Module attributes used: `@max_size`.
(unary_operator
  operator: "@"
  operand: (identifier) @name) @reference.constant
