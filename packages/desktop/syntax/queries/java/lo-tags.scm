; Lo's additions to tree-sitter-java's tags, for what they leave out. They come after the grammar's
; own, so where both define a name, or both use it, the grammar's tag wins.

; Enums and their constants, records and annotation types.
(enum_declaration
  name: (identifier) @name) @definition.enum

(enum_constant
  name: (identifier) @name) @definition.constant

(record_declaration
  name: (identifier) @name) @definition.class

(annotation_type_declaration
  name: (identifier) @name) @definition.interface

; Fields, and an interface's constants. Their declarators are matched without the field, which
; matches only the first of `int a, b;`.
(field_declaration
  (variable_declarator
    name: (identifier) @name) @definition.field)

(constant_declaration
  (variable_declarator
    name: (identifier) @name) @definition.constant)

; Types wherever they're named: `List<Circle>`, `Circle[]`, `throws IOException`.
(type_identifier) @name @reference.type

; Fields read or written: `this.radius`, `Math.PI`.
(field_access
  field: (identifier) @name) @reference.field

; Methods named as values: `Circle::area`.
(method_reference
  (identifier) @name .) @reference.call

; Constants and classes used by name: `MAX`, `Math`, `@Override`.
((identifier) @name @reference.constant
  (#match? @name "^[A-Z]"))
