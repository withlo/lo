; Lo's additions to tree-sitter-ruby's tags, for what they leave out. They come after the grammar's
; own, so where both define a name, or both use it, the grammar's tag wins.

; Constants: `MAX_SIZE = 10`.
(assignment
  left: (constant) @name) @definition.constant
