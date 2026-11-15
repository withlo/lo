; Lo's patterns for the statements that import, for Rust: `use` and a `mod` in a file of its own.
; The code that reads each is in src/imports.ts.

(use_declaration) @import

(mod_item
  name: (identifier)
  !body) @import
