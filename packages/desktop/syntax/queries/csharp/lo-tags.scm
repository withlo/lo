; Lo's additions to tree-sitter-c-sharp's tags, for what they leave out. They come after the
; grammar's own, so where both define a name, or both use it, the grammar's tag wins.

; Structs, records, enums and their members, and delegates.
(struct_declaration
  name: (identifier) @name) @definition.class

(record_declaration
  name: (identifier) @name) @definition.class

(enum_declaration
  name: (identifier) @name) @definition.enum

(enum_member_declaration
  name: (identifier) @name) @definition.constant

(delegate_declaration
  name: (identifier) @name) @definition.type

; Properties, fields and events. A field's declarators are matched without the field, which
; matches only the first of `double a, b;`.
(property_declaration
  name: (identifier) @name) @definition.property

(field_declaration
  (variable_declaration
    (variable_declarator
      name: (identifier) @name) @definition.field))

(event_field_declaration
  (variable_declaration
    (variable_declarator
      name: (identifier) @name) @definition.field))

; Local functions.
(local_function_statement
  name: (identifier) @name) @definition.function

; Calls by name: `Area()`.
(invocation_expression
  function: (identifier) @name) @reference.call

; Members read or written, not only called: `circle.Radius`, `Math.PI`.
(member_access_expression
  name: (identifier) @name) @reference.field

; Generic types: `List<Circle>`.
(generic_name
  (identifier) @name) @reference.type

; Constants, types and members used by name: `Max`, `Circle`, `Radius`.
((identifier) @name @reference.constant
  (#match? @name "^[A-Z]"))
