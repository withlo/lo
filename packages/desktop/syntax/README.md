# syntax

Syntax highlighting, and the parts of the syntax index that read code: its tags and its ranking,
with [tree-sitter](https://tree-sitter.github.io/) grammars compiled to WebAssembly. Highlighting
and tagging run on worker threads in the background process. To highlight, a file's text goes in,
and its tokens come out as `[from, to, token]` triples for the `lo-syn-*` classes in
`design/css/code.css`. To tag, its definitions, the names it uses and its imports come out (see
"Tags"). The index's store isn't here; see "The index's store".

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

The highlight and injection queries in `queries/` come from the grammars' own repositories, or for
some languages from the extensions Zed installs, and the tag queries from the grammars' own
repositories. All are under the MIT License or the Apache License 2.0; `queries/README.md` says from
where, and under which.

## Tags

A `Tagger` reads a file in TypeScript, TSX, JavaScript, Python, Rust, Go, Java, Kotlin, C#, PHP,
Ruby, Swift, Elixir or Terraform with its tag queries, and what it reads depends only on the text,
so the index can keep one reading per blob:

- `symbols` gives its definitions, each with its kind, its name's line and column, its last line and
  the definition it's inside; the names it uses, each once; and its imports, with the package or
  namespace it says it's in. Where patterns tag a name both ways, it's a definition, even where a
  grammar's query `@ignore`s it.
- `find` gives where it uses one name, for the references of a name found in the files that use it.

`rank` orders a name's definitions for the file asking: the same file, the same folder, a file its
imports name, then the rest, each in path order, leaving out languages the asking file can't call.
Its imports are matched by a guess for each language from its path and imports alone, never a
project's manifest: relative imports for TypeScript and JavaScript, `from` for Python, `crate::`,
`self::`, `super::` and `mod` for Rust, the import path's last folders for Go, `import` and
`package` for Java and Kotlin, and `use` with PSR-4's folders for PHP. Every answer is labelled
"Code index", or "Code index · same name" when only its name links it to the asking file.

`tagsVersion` is a hash of the grammars the tagged languages parse with, the version of
`web-tree-sitter` that runs them, their tag queries and the code that reads them, the depth guard in
`src/depth.ts` and the runtime included, written by `pnpm nx run syntax:codegen`. It changes with
any of them, so the index can tell which of its readings to make again.

A file is read with the highlighter's limits, and isn't read at all past a million characters, with
a line over 10,000 characters, as minified files have, with a NUL, as binary files have, or with
more than 100,000 names tagged, which bounds the memory a reading takes.

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

## The index's store

The store that keeps these readings isn't in this package: it's the app's, in main
(`apps/desktop/src/features/code/main/store/`), where a worker thread of main opens it as
`code/symbols.db` in Lo's cache. It keeps each blob's reading once, by its ID and language, stamped
with `tagsVersion`, and each tree's files, and finds a name's definitions across a tree. Main picks
which files of a tree to read and sends them to the background process as jobs that call `Tagger`;
it keeps what comes back, and calls `rank` to order a name's definitions for the file asking.
`AGENTS.md`, under "The syntax index", has the rest.
