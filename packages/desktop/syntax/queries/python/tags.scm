; From tree-sitter-python (https://github.com/tree-sitter/tree-sitter-python), queries/tags.scm
; at 293fdc02038ee2bf0e2e206711b69c90ac0d413f.
; Copyright (c) 2016 Max Brunsfeld. MIT.

(module (expression_statement (assignment left: (identifier) @name) @definition.constant))

(class_definition
  name: (identifier) @name) @definition.class

(function_definition
  name: (identifier) @name) @definition.function

(call
  function: [
      (identifier) @name
      (attribute
        attribute: (identifier) @name)
  ]) @reference.call
