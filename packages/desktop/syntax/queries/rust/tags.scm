; From tree-sitter-rust (https://github.com/tree-sitter/tree-sitter-rust), queries/tags.scm
; at 77a3747266f4d621d0757825e6b11edcbf991ca5.
; Copyright (c) 2017 Maxim Sokolov. MIT.
; Changed for Lo: methods are the functions in an `impl` or a trait, where the grammar's query
; took those in a module's block, `mod inner { … }`, for methods too.

; ADT definitions

(struct_item
    name: (type_identifier) @name) @definition.class

(enum_item
    name: (type_identifier) @name) @definition.class

(union_item
    name: (type_identifier) @name) @definition.class

; type aliases

(type_item
    name: (type_identifier) @name) @definition.class

; method definitions

(impl_item
    body: (declaration_list
        (function_item
            name: (identifier) @name) @definition.method))

(trait_item
    body: (declaration_list
        (function_item
            name: (identifier) @name) @definition.method))

; function definitions

(function_item
    name: (identifier) @name) @definition.function

; trait definitions
(trait_item
    name: (type_identifier) @name) @definition.interface

; module definitions
(mod_item
    name: (identifier) @name) @definition.module

; macro definitions

(macro_definition
    name: (identifier) @name) @definition.macro

; references

(call_expression
    function: (identifier) @name) @reference.call

(call_expression
    function: (field_expression
        field: (field_identifier) @name)) @reference.call

(macro_invocation
    macro: (identifier) @name) @reference.call

; implementations

(impl_item
    trait: (type_identifier) @name) @reference.implementation

(impl_item
    type: (type_identifier) @name
    !trait) @reference.implementation
