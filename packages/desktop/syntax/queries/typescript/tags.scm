; From tree-sitter-typescript (https://github.com/zed-industries/tree-sitter-typescript), queries/tags.scm
; at e2c53597d6a5d9cf7bbe8dccde576fe1e46c5899.
; Copyright (c) 2017 Max Brunsfeld. MIT.

(function_signature
  name: (identifier) @name) @definition.function

(method_signature
  name: (property_identifier) @name) @definition.method

(abstract_method_signature
  name: (property_identifier) @name) @definition.method

(abstract_class_declaration
  name: (type_identifier) @name) @definition.class

(module
  name: (identifier) @name) @definition.module

(interface_declaration
  name: (type_identifier) @name) @definition.interface

(type_annotation
  (type_identifier) @name) @reference.type

(new_expression
  constructor: (identifier) @name) @reference.class
