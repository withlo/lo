; From tree-sitter-kotlin (https://github.com/fwcd/tree-sitter-kotlin), queries/tags.scm
; at 1852ea17b7f60fb3f9d84e0b1555d56b46b39fb1.
; Copyright (c) 2019 fwcd. MIT.
; Changed for Lo: properties are tagged only at the top of a file and in a class's or object's
; body, where the grammar's query tagged every property, the local ones in function bodies too.

; Classes
(class_declaration
  (type_identifier) @name) @definition.class

; Objects
(object_declaration
  (type_identifier) @name) @definition.class

; Functions (top-level and member)
(function_declaration
  (simple_identifier) @name) @definition.function

; Properties
(source_file
  (property_declaration
    (variable_declaration
      (simple_identifier) @name)) @definition.constant)

(class_body
  (property_declaration
    (variable_declaration
      (simple_identifier) @name)) @definition.constant)

; Enum entries
(enum_entry
  (simple_identifier) @name) @definition.constant

; Type aliases
(type_alias
  (type_identifier) @name) @definition.type

; Companion objects (only named ones)
(companion_object
  (type_identifier) @name) @definition.class

; Function calls
(call_expression
  (simple_identifier) @name) @reference.call

; Method calls via navigation
(call_expression
  (navigation_expression
    (navigation_suffix
      (simple_identifier) @name))) @reference.call

; Constructor invocations (class references)
(constructor_invocation
  (user_type
    (type_identifier) @name)) @reference.class
