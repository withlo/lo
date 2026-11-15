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

| Grammar                   | Source                                                                                            | License                                                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| bash                      | [tree-sitter/tree-sitter-bash](https://github.com/tree-sitter/tree-sitter-bash)                   | MIT, Copyright (c) 2017 Max Brunsfeld                                                                                             |
| c_sharp                   | [tree-sitter/tree-sitter-c-sharp](https://github.com/tree-sitter/tree-sitter-c-sharp)             | MIT, Copyright (c) 2014-2023 Max Brunsfeld, Damien Guard, Amaan Qureshi, and contributors                                         |
| css                       | [tree-sitter/tree-sitter-css](https://github.com/tree-sitter/tree-sitter-css)                     | MIT, Copyright (c) 2018 Max Brunsfeld                                                                                             |
| elixir                    | [elixir-lang/tree-sitter-elixir](https://github.com/elixir-lang/tree-sitter-elixir)               | Apache-2.0, Copyright 2021 The Elixir Team; its generated parser MIT, Copyright (c) 2018-2021 Max Brunsfeld, as its `NOTICE` says |
| go                        | [zed-industries/tree-sitter-go](https://github.com/zed-industries/tree-sitter-go)                 | MIT, Copyright (c) 2014 Max Brunsfeld                                                                                             |
| hcl                       | [tree-sitter-grammars/tree-sitter-hcl](https://github.com/tree-sitter-grammars/tree-sitter-hcl)   | Apache-2.0, the tree-sitter-hcl authors                                                                                           |
| html                      | [tree-sitter/tree-sitter-html](https://github.com/tree-sitter/tree-sitter-html)                   | MIT, Copyright (c) 2014 Max Brunsfeld                                                                                             |
| java                      | [tree-sitter/tree-sitter-java](https://github.com/tree-sitter/tree-sitter-java)                   | MIT, Copyright (c) 2017 Ayman Nadeem                                                                                              |
| json                      | [tree-sitter/tree-sitter-json](https://github.com/tree-sitter/tree-sitter-json)                   | MIT, Copyright (c) 2014 Max Brunsfeld                                                                                             |
| kotlin                    | [fwcd/tree-sitter-kotlin](https://github.com/fwcd/tree-sitter-kotlin)                             | MIT, Copyright (c) 2019 fwcd                                                                                                      |
| markdown, markdown_inline | [zed-industries/tree-sitter-markdown](https://github.com/zed-industries/tree-sitter-markdown)     | MIT, Copyright (c) 2021 Matthias Deiml                                                                                            |
| php                       | [tree-sitter/tree-sitter-php](https://github.com/tree-sitter/tree-sitter-php)                     | MIT, Copyright (c) 2017 Josh Vera, GitHub, (c) 2019 Max Brunsfeld, Amaan Qureshi, Christian Frøystad, Caleb White                 |
| python                    | [tree-sitter/tree-sitter-python](https://github.com/tree-sitter/tree-sitter-python)               | MIT, Copyright (c) 2016 Max Brunsfeld                                                                                             |
| ruby                      | [tree-sitter/tree-sitter-ruby](https://github.com/tree-sitter/tree-sitter-ruby)                   | MIT, Copyright (c) 2016 Rob Rix                                                                                                   |
| rust                      | [tree-sitter/tree-sitter-rust](https://github.com/tree-sitter/tree-sitter-rust)                   | MIT, Copyright (c) 2017 Maxim Sokolov                                                                                             |
| swift                     | [alex-pinkus/tree-sitter-swift](https://github.com/alex-pinkus/tree-sitter-swift)                 | MIT, Copyright (c) 2021 alex-pinkus                                                                                               |
| toml                      | [tree-sitter/tree-sitter-toml](https://github.com/tree-sitter/tree-sitter-toml)                   | MIT, Copyright (c) Ika                                                                                                            |
| tsx, typescript           | [zed-industries/tree-sitter-typescript](https://github.com/zed-industries/tree-sitter-typescript) | MIT, Copyright (c) 2017 Max Brunsfeld                                                                                             |
| yaml                      | [zed-industries/tree-sitter-yaml](https://github.com/zed-industries/tree-sitter-yaml)             | MIT, Copyright (c) 2024 tree-sitter-grammars contributors, (c) 2019-2021 Ika                                                      |

Each grammar's full notice is in its repository at the commit `grammars.json` names, and the Apache
License 2.0 that the Elixir and HCL grammars are under is in `queries/LICENSE-APACHE`. The built
grammars aren't committed.

A highlighter loads a grammar the first time a text needs it, in its language or one it injects, not
when it starts, so a job that meets one language loads one grammar.

### Lexers

tree-sitter generates a grammar's lexer as one function, which for Swift is 300 KB of WebAssembly.
V8 compiles a function that runs often a second time, with its optimizing compiler, whose memory
grows with the function's size and isn't all given back. So before it builds a grammar, the build
splits each lexer longer than 500 lines into functions of at most 500 (`scripts/split.ts`), which
run as fast. Highlighting one real Swift file, a worker thread under Electron grew by 385 MB at its
peak and kept 98 MB; split, it grows by 60 MB and keeps 40 MB. With a file in each language, it grew
by 516 MB and kept 142 MB, and now grows by 141 MB and keeps 67 MB. Node 24, which runs the tests,
took 2.7 GB to compile Swift's lexer and kept it.

### Patches

`patches/` holds changes to a grammar's source, applied before it's built:

- `python-serialize.patch`: the Python scanner saved two bytes a level of indentation while it had
  any room left, so where the bytes before them were odd in number, as with a string open, it wrote
  a byte beyond tree-sitter's 1,024-byte buffer past about 510 levels and broke the WebAssembly
  memory. It now stops while two more bytes fit.
- `ruby-serialize.patch`: the Ruby scanner saved four bytes and the word of each open heredoc while
  two bytes and the word fitted, so with 93 heredocs of seven letters open on a line it wrote a byte
  beyond tree-sitter's 1,024-byte buffer and broke the WebAssembly memory. It saved a word's length
  in one byte, so it misread a word longer than 255 and failed an assertion. It now saves nothing
  unless all of every heredoc fits, as it did past the buffer, nor a word longer than 255.
- `swift-create.patch`: the Swift scanner allocated no bytes for its state, then wrote four, so a
  raw string's count of `#`s started from whatever those bytes held. It now allocates its state.
- `yaml-serialize.patch`: the YAML scanner saved four bytes a level of indentation while it had any
  room left, so past about 250 levels it wrote two bytes beyond tree-sitter's 1,024-byte buffer and
  broke the WebAssembly memory every later parse used. It now stops while four more bytes fit.

## Queries

The highlight queries in `queries/` come from Zed and the extensions it installs, under the
GPL-3.0-or-later, the Apache License 2.0 and the MIT License; `queries/README.md` says from where,
and under which.

## Limits

A file longer than eight million characters, or nested more than a hundred levels deep, isn't
parsed. Nesting counts brackets outside comments, strings and regular expressions, with code
interpolated into a string, such as Kotlin's `${}`, a level inside it, and Markdown's quotes and
Markdown's and YAML's indentation. Parsing, querying and the parses of injected languages stop after
two seconds, or once the WebAssembly memory passes 256 MB.

A scanner that aborts on a file, as Kotlin's does with strings nested 512 deep, fails only that
file. Any other failure in WebAssembly can leave its memory broken, and that memory never shrinks,
so once a highlighter fails, its memory passes 256 MB, or its thread has had eight aborts, it says
it isn't `usable`, and its worker thread should be replaced.
