; Lo's patterns for the statements that import, for JavaScript and TypeScript: `import`, `export …
; from`, `require('…')` and `import('…')`. The code that reads each is in src/imports.ts.

(import_statement) @import

(export_statement
  source: (_)) @import

(call_expression
  function: (identifier) @_require
  arguments: (arguments . (string) .)
  (#eq? @_require "require")) @import

(call_expression
  function: (import)
  arguments: (arguments . (string) .)) @import
