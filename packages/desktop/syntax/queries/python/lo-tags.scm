; Lo's additions to tree-sitter-python's tags, for what they leave out. They come after the
; grammar's own, so where both define a name, or both use it, the grammar's tag wins.

; Class attributes: `radius: float`, `count = 0`.
(class_definition
  body: (block
    (expression_statement
      (assignment
        left: (identifier) @name) @definition.field)))

; Decorators without arguments, `@dataclass`. With arguments, they're calls already.
(decorator
  (identifier) @name) @reference.call

; Types in annotations: `-> list[Circle]`, `x: int`.
(type
  (identifier) @name) @reference.type

(generic_type
  (identifier) @name) @reference.type

; Attributes read or written, not only called: `self.radius`, `math.pi`, `shapes.Shape`.
(attribute
  attribute: (identifier) @name) @reference.field

; Names imported: `from .shapes import Circle`.
(import_from_statement
  name: [
    (dotted_name
      (identifier) @name .)
    (aliased_import
      name: (dotted_name
        (identifier) @name .))
  ]) @reference.import

; Constants and classes used by name: `MAX_SIZE`, `Circle`.
((identifier) @name @reference.constant
  (#match? @name "^[A-Z]"))
