; Lo's additions to the JavaScript and TypeScript tags, for what they leave out. They come after
; the grammars' own, so where both define a name, or both use it, the grammars' tag wins.
; JavaScript is read with the TSX grammar, which has TypeScript's syntax and JSX, so these are for
; all three.

; Type aliases, enums and their members, and namespaces.
(type_alias_declaration
  name: (type_identifier) @name) @definition.type

(enum_declaration
  name: (identifier) @name) @definition.enum

(enum_body
  name: (property_identifier) @name @definition.constant)

(enum_assignment
  name: (property_identifier) @name) @definition.constant

(internal_module
  name: (identifier) @name) @definition.module

; Constants and variables at the top of a file or a namespace, exported or not. Those that hold a
; function are functions already.
(program
  (lexical_declaration
    kind: "const"
    (variable_declarator
      name: (identifier) @name) @definition.constant))

(program
  (export_statement
    declaration: (lexical_declaration
      kind: "const"
      (variable_declarator
        name: (identifier) @name) @definition.constant)))

(program
  [
    (lexical_declaration
      (variable_declarator
        name: (identifier) @name) @definition.variable)
    (variable_declaration
      (variable_declarator
        name: (identifier) @name) @definition.variable)
    (export_statement
      declaration: [
        (lexical_declaration
          (variable_declarator
            name: (identifier) @name) @definition.variable)
        (variable_declaration
          (variable_declarator
            name: (identifier) @name) @definition.variable)
      ])
  ])

(program
  (ambient_declaration
    (lexical_declaration
      (variable_declarator
        name: (identifier) @name) @definition.constant)))

(program
  (ambient_declaration
    (variable_declaration
      (variable_declarator
        name: (identifier) @name) @definition.variable)))

(program
  (export_statement
    declaration: (ambient_declaration
      (lexical_declaration
        (variable_declarator
          name: (identifier) @name) @definition.constant))))

(internal_module
  body: (statement_block
    (export_statement
      declaration: (lexical_declaration
        (variable_declarator
          name: (identifier) @name) @definition.constant))))

; Class fields, private methods, and the properties of interfaces and of the object types that
; type aliases name, not of the types written inline, which no one names.
(public_field_definition
  name: [
    (property_identifier)
    (private_property_identifier)
  ] @name) @definition.field

(method_definition
  name: (private_property_identifier) @name) @definition.method

(interface_body
  (property_signature
    name: (property_identifier) @name) @definition.field)

(type_alias_declaration
  value: (object_type
    (property_signature
      name: (property_identifier) @name) @definition.field))

; Types wherever they're named, not only in annotations: `implements Shape`, `Shape[]`, `<Shape>`.
(type_identifier) @name @reference.type

; Classes extended: `class Circle extends Base`.
(extends_clause
  value: (identifier) @name) @reference.class

; Members read or written, not only called: `circle.radius`, `this.#count`.
(member_expression
  property: [
    (property_identifier)
    (private_property_identifier)
  ] @name) @reference.field

; Names imported or re-exported: `import { parse } from './parse'`.
(import_specifier
  name: (identifier) @name) @reference.import

(export_specifier
  name: (identifier) @name) @reference.import

; Constants, classes and components used by name: `MAX`, `Color.Red`, `<Button />`.
((identifier) @name @reference.constant
  (#match? @name "^[A-Z]"))
