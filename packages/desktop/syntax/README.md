# syntax

Syntax highlighting with [tree-sitter](https://tree-sitter.github.io/) grammars compiled to
WebAssembly. It runs on worker threads in the background process: a file's text goes in, and its
tokens come out as `[from, to, token]` triples for the `lo-syn-*` classes in `design/css/code.css`.

## Grammars

`pnpm nx run syntax:build` builds each grammar in `grammars.json` to `dist/grammars/`. It checks
everything it runs and builds from: the tree-sitter CLI's binary and the WebAssembly toolchain it
builds with (wasi-sdk and binaryen) against pinned SHA-256s, each grammar's source by its commit,
and each built grammar against the SHA-256 recorded in `grammars.json`. The toolchain is downloaded
once to `lo/tree-sitter` in the user's cache folder.

| Grammar                   | Source                                                                                            | License                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| bash                      | [tree-sitter/tree-sitter-bash](https://github.com/tree-sitter/tree-sitter-bash)                   | MIT, Copyright (c) 2017 Max Brunsfeld                                        |
| go                        | [zed-industries/tree-sitter-go](https://github.com/zed-industries/tree-sitter-go)                 | MIT, Copyright (c) 2014 Max Brunsfeld                                        |
| json                      | [tree-sitter/tree-sitter-json](https://github.com/tree-sitter/tree-sitter-json)                   | MIT, Copyright (c) 2014 Max Brunsfeld                                        |
| markdown, markdown_inline | [zed-industries/tree-sitter-markdown](https://github.com/zed-industries/tree-sitter-markdown)     | MIT, Copyright (c) 2021 Matthias Deiml                                       |
| tsx, typescript           | [zed-industries/tree-sitter-typescript](https://github.com/zed-industries/tree-sitter-typescript) | MIT, Copyright (c) 2017 Max Brunsfeld                                        |
| yaml                      | [zed-industries/tree-sitter-yaml](https://github.com/zed-industries/tree-sitter-yaml)             | MIT, Copyright (c) 2024 tree-sitter-grammars contributors, (c) 2019-2021 Ika |

Each grammar's full MIT notice is in its repository at the commit `grammars.json` names. The built
grammars aren't committed.

### Patches

`patches/` holds changes to a grammar's source, applied before it's built:

- `yaml-serialize.patch`: the YAML scanner saved four bytes a level of indentation while it had any
  room left, so past about 250 levels it wrote two bytes beyond tree-sitter's 1,024-byte buffer and
  broke the WebAssembly memory every later parse used. It now stops while four more bytes fit.

## Queries

The highlight queries in `queries/` come from Zed, under the GPL-3.0-or-later; `queries/README.md`
says from where.

## Limits

A file longer than eight million characters, or nested more than a hundred levels deep, isn't
parsed. Nesting counts brackets outside comments, strings and regular expressions, and Markdown's
quotes and Markdown's and YAML's indentation. Parsing, querying and the parses of injected languages
stop after two seconds, or once the WebAssembly memory passes 256 MB. That memory never shrinks, so
once a highlighter fails or its memory passes 256 MB it says it isn't `usable`, and its worker
thread should be replaced.
