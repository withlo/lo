; Lo's additions to tree-sitter-swift's tags, for what they leave out. They come after the
; grammar's own, so where both define a name, or both use it, the grammar's tag wins.

; Enum cases, typealiases and protocols' properties. Cases are matched without the field, which
; matches only the first of `case round, flat`.
(enum_entry
  (simple_identifier) @name) @definition.constant

(typealias_declaration
  name: (type_identifier) @name) @definition.type

(protocol_property_declaration
  (pattern
    (simple_identifier) @name)) @definition.property

; Calls: `area()`, `Circle.unit()`.
(call_expression
  (simple_identifier) @name) @reference.call

; Types wherever they're named: `[Circle]`, `: Shape`.
(user_type
  (type_identifier) @name) @reference.type

; Members read or written, not only called: `self.radius`, `Double.pi`.
(navigation_suffix
  (simple_identifier) @name) @reference.field

; Constants and types used by name: `Circle`, `Kind`.
((simple_identifier) @name @reference.constant
  (#match? @name "^[A-Z]"))
