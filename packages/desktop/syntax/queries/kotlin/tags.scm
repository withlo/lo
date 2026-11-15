; From tree-sitter-kotlin (https://github.com/fwcd/tree-sitter-kotlin), queries/tags.scm
; at 1852ea17b7f60fb3f9d84e0b1555d56b46b39fb1.
; Copyright (c) 2019 fwcd. MIT.
; Changed for Lo: interfaces are tagged as interfaces, where the grammar's query tagged them as
; classes; and properties only at the top of a file and in a class's or object's body, a `val` as
; a constant and a `var` as a variable, where it tagged every property as a constant, the local
; ones in function bodies too.

; Interfaces, `fun interface` too, before classes, so that their tag wins
(class_declaration
  "interface"
  (type_identifier) @name) @definition.interface

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
    (binding_pattern_kind "val")
    (variable_declaration
      (simple_identifier) @name)) @definition.constant)

(source_file
  (property_declaration
    (binding_pattern_kind "var")
    (variable_declaration
      (simple_identifier) @name)) @definition.variable)

(class_body
  (property_declaration
    (binding_pattern_kind "val")
    (variable_declaration
      (simple_identifier) @name)) @definition.constant)

(class_body
  (property_declaration
    (binding_pattern_kind "var")
    (variable_declaration
      (simple_identifier) @name)) @definition.variable)

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
