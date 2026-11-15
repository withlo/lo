; Lo's additions to tree-sitter-kotlin's tags, for what they leave out. They come after the
; grammar's own, so where both define a name, or both use it, the grammar's tag wins.

; Properties declared in a constructor: `class Circle(val radius: Double)`.
(class_parameter
  (binding_pattern_kind)
  (simple_identifier) @name) @definition.property

; Types wherever they're named: `List<Circle>`, `: Shape`.
(user_type
  (type_identifier) @name) @reference.type

; Members read or written, not only called: `circle.radius`, `Math.PI`.
(navigation_suffix
  (simple_identifier) @name) @reference.field

; Names imported: `import com.acme.shapes.circleOf`.
(import_header
  (identifier
    (simple_identifier) @name .)) @reference.import

; Constants and classes used by name: `MAX`, `Kind.ROUND`.
((simple_identifier) @name @reference.constant
  (#match? @name "^[A-Z]"))
