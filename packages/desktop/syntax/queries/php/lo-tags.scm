; Lo's additions to tree-sitter-php's tags, for what they leave out. They come after the grammar's
; own, so where both define a name, or both use it, the grammar's tag wins.

; Constants, a file's and a class's, and enums with their cases.
(const_declaration
  (const_element
    (name) @name) @definition.constant)

(enum_declaration
  name: (name) @name) @definition.enum

(enum_case
  name: (name) @name) @definition.constant

; Calls by a plain name: `format($x)`.
(function_call_expression
  function: (name) @name) @reference.call

; Properties read or written, and constants through their class: `$this->radius`, `Circle::SIDES`.
(member_access_expression
  name: (name) @name) @reference.field

(class_constant_access_expression
  (_)
  (name) @name) @reference.field

; Types: `Area $shape`, `: Circle`.
(named_type
  (name) @name) @reference.type

; Classes and constants used by name: `Circle`, `M_PI`.
((name) @name @reference.constant
  (#match? @name "^[A-Z]"))
