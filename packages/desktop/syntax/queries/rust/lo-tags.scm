; Lo's additions to tree-sitter-rust's tags, for what they leave out. They come after the grammar's
; own, so where both define a name, or both use it, the grammar's tag wins.

; Trait methods without a body.
(trait_item
  body: (declaration_list
    (function_signature_item
      name: (identifier) @name) @definition.method))

; Functions declared without a body anywhere else, as in `extern "C" { … }`.
(function_signature_item
  name: (identifier) @name) @definition.function

; Constants and statics.
(const_item
  name: (identifier) @name) @definition.constant

(static_item
  name: (identifier) @name) @definition.constant

; Enum variants and struct fields.
(enum_variant
  name: (identifier) @name) @definition.constant

(field_declaration
  name: (field_identifier) @name) @definition.field

; Associated types in traits.
(associated_type
  name: (type_identifier) @name) @definition.type

; Calls through a path or with a turbofish: `Circle::new()`, `size_of::<T>()`.
(call_expression
  function: (scoped_identifier
    name: (identifier) @name)) @reference.call

(call_expression
  function: (generic_function
    function: [
      (identifier) @name
      (scoped_identifier
        name: (identifier) @name)
      (field_expression
        field: (field_identifier) @name)
    ])) @reference.call

; Macros through a path: `tracing::info!()`.
(macro_invocation
  macro: (scoped_identifier
    name: (identifier) @name)) @reference.call

; Types wherever they're named.
(type_identifier) @name @reference.type

; Every part of other paths: `Shape::Round`, `std::mem`, `use crate::stacks::Stack`.
(scoped_identifier
  path: (identifier) @name) @reference.path

(scoped_identifier
  name: (identifier) @name) @reference.path

(scoped_type_identifier
  path: (identifier) @name) @reference.path

; Fields read, written or set: `self.radius`, `Circle { radius: 1.0 }`.
(field_expression
  field: (field_identifier) @name) @reference.field

(field_initializer
  field: (field_identifier) @name) @reference.field

; Names imported: `use crate::shapes::{Circle, area}`.
(use_list
  (identifier) @name) @reference.import

(use_as_clause
  path: (identifier) @name) @reference.import

; Constants and variants used by name: `MAX`, `Some`.
((identifier) @name @reference.constant
  (#match? @name "^[A-Z]"))
