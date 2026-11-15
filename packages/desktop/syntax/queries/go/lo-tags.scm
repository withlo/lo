; Lo's additions to tree-sitter-go's tags, for what they leave out. They come after the grammar's
; own, so where both define a name, or both use it, the grammar's tag wins.

; Package-level constants and variables. Their names are the specs' own identifiers, matched
; without the field, which matches only the first of `a, b = 1, 2`.
(source_file
  (const_declaration
    (const_spec
      (identifier) @name) @definition.constant))

(source_file
  (var_declaration
    (var_spec
      (identifier) @name) @definition.variable))

(source_file
  (var_declaration
    (var_spec_list
      (var_spec
        (identifier) @name) @definition.variable)))

; Interface methods and struct fields.
(method_elem
  name: (field_identifier) @name) @definition.method

(field_declaration
  (field_identifier) @name) @definition.field

; Fields and package members used without a call: `c.Radius`, `math.Pi`.
(selector_expression
  field: (field_identifier) @name) @reference.field

; Fields set in a literal: `Circle{Radius: 1}`.
(keyed_element
  key: (literal_element
    (identifier) @name)) @reference.field

; Exported names used in their own package: `MaxSize`, `Default`.
((identifier) @name @reference.constant
  (#match? @name "^[A-Z]"))
