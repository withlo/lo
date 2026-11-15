# Queries

Each language's `highlights.scm` and `injections.scm` come from Zed, as each file's header says:
from [Zed](https://github.com/zed-industries/zed) itself at
[`c84af5b99cbc366d675064e52b23664a015b6e35`](https://github.com/zed-industries/zed/tree/c84af5b99cbc366d675064e52b23664a015b6e35),
its 1.27.0 release, or from the extension Zed's extension registry installs for the language, at the
commit the registry pins. Their capture names match the `lo-syn-*` tokens in `design/css/code.css`,
and `grammars.json` pins each grammar to the commit these queries were written for: the one in Zed's
`Cargo.lock`, or the one the extension's `extension.toml` names.

| Queries                                                                                                | Source                                                                                                                | License                                                |
| ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| bash, css, go, javascript, json, jsonc, markdown, markdown-inline, python, rust, tsx, typescript, yaml | [Zed](https://github.com/zed-industries/zed), `crates/grammars/src`                                                   | GPL-3.0-or-later, Copyright Zed Industries, Inc.       |
| html                                                                                                   | [Zed](https://github.com/zed-industries/zed), `extensions/html`                                                       | Apache-2.0, Copyright 2022 - 2025 Zed Industries, Inc. |
| csharp                                                                                                 | [zed-extensions/csharp](https://github.com/zed-extensions/csharp) at `88597e19d1323c7c4c3385093d9cdcb4ee78513e`       | Apache-2.0, Copyright 2022-2024 Zed Industries, Inc.   |
| elixir                                                                                                 | [zed-extensions/elixir](https://github.com/zed-extensions/elixir) at `f02229c005cfee90f54be99ec1943d455049668e`       | Apache-2.0, Copyright 2022-2024 Zed Industries, Inc.   |
| java                                                                                                   | [zed-extensions/java](https://github.com/zed-extensions/java) at `2facaa7c4038d0b2dc8204e4b44b7a7c81405564`           | Apache-2.0, the Java extension's contributors          |
| kotlin                                                                                                 | [zed-extensions/kotlin](https://github.com/zed-extensions/kotlin) at `e94974ea06f6494f003efc3161691a59ea1b3300`       | MIT, Copyright (c) 2024 Evren Sen                      |
| php                                                                                                    | [zed-extensions/php](https://github.com/zed-extensions/php) at `6768398bea34ea3b2ad590ac8081eb6c1ce6bf29`             | Apache-2.0, Copyright 2022 - 2025 Zed Industries, Inc. |
| ruby                                                                                                   | [zed-extensions/ruby](https://github.com/zed-extensions/ruby) at `13ebcebfad082ec3942ea23952d6a97437ee11a9`           | Apache-2.0, Copyright 2022 - 2024 Zed Industries, Inc. |
| swift                                                                                                  | [zed-extensions/swift](https://github.com/zed-extensions/swift) at `302c7978f1bc3d512960531ce11000ca333d5268`         | Apache-2.0, the Swift extension's authors              |
| hcl, terraform                                                                                         | [zed-extensions/terraform](https://github.com/zed-extensions/terraform) at `99bcfa52db879b6f71b803307a9640e04e336623` | Apache-2.0, Copyright 2022-2024 Zed Industries, Inc.   |
| toml                                                                                                   | [zed-extensions/toml](https://github.com/zed-extensions/toml) at `8e18e5045841f0f265f9c8b89f138c7f7dd09e2e`           | Apache-2.0, Copyright 2022-2025 Zed Industries, Inc.   |

The Apache License 2.0 is in [`LICENSE-APACHE`](LICENSE-APACHE). The Kotlin and Terraform queries
say they're based on [nvim-treesitter](https://github.com/nvim-treesitter/nvim-treesitter)'s, which
are under the Apache License 2.0 too. The Kotlin queries' MIT notice:

> Copyright (c) 2024 Evren Sen
>
> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
> associated documentation files (the "Software"), to deal in the Software without restriction,
> including without limitation the rights to use, copy, modify, merge, publish, distribute,
> sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or
> substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
> NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
> NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
> DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT
> OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## Changes

The queries are as their sources have them, apart from these changes, which each changed file's
header notes:

- The JSDoc injection's `#match?` in the three JavaScript and TypeScript `injections.scm` used the
  `(?s)` flag, which JavaScript's `RegExp` lacks, so it matches any character with `[\s\S]` instead.
- Rust's `highlights.scm` and Elixir's `highlights.scm` and `injections.scm` had patterns whose
  predicates name a capture that only some of their alternatives have. web-tree-sitter fails a
  predicate on a capture a match lacks, where tree-sitter's own library passes it, so those patterns
  never matched. Each is split in two: one pattern for the alternatives with the capture, with its
  predicate, and one for the rest.

## How they're read

`src/queries.test.ts` compiles every query against its grammar and checks that each capture has a
token or is meant to have none. A few queries use older capture names, such as Kotlin's `@float` and
`@parameter`, which `src/tokens.ts` maps to the tokens they mean. Injections may name their language
and text with tree-sitter's `injection.` captures and properties, or with the older names without it
(`@content`, `(#set! "language" "regex")`), as Kotlin's and Ruby's do. Predicates web-tree-sitter
doesn't know, such as Swift's `#lua-match?`, are ignored.

To update them, copy the same files from a newer Zed release or extension, move `grammars.json`'s
commits to the ones it names, and run the build and the tests.

## Tags

The syntax index reads each language's definitions, the names it uses and its imports with three
queries, run as one: its grammar's own `tags.scm`, Lo's additions after it in `lo-tags.scm`, and
Lo's patterns for its import statements in `imports.scm`, which `src/imports.ts` reads.
`src/tagged.ts` lists which each language takes. TypeScript and TSX take JavaScript's `tags.scm`
after their own, as their grammar's `tree-sitter.json` does, and JavaScript, read with the TSX
grammar, takes TypeScript's additions. HCL's grammar has no `tags.scm`, so Terraform's tags are all
Lo's.

Where patterns tag one name, a definition wins over a use, and otherwise the earliest pattern's tag
wins, so the grammar's tags win over Lo's. An `@ignore`, with which a grammar's query keeps later
patterns from using a name, counts as a use: a definition still wins over it, as Lo's definitions of
Elixir's module attributes do over the grammar's `@ignore` of them.

| `tags.scm` | Source                                                                                                          | License                                                                                                           |
| ---------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| csharp     | [tree-sitter/tree-sitter-c-sharp](https://github.com/tree-sitter/tree-sitter-c-sharp)                           | MIT, Copyright (c) 2014-2023 Max Brunsfeld, Damien Guard, Amaan Qureshi, and contributors                         |
| elixir     | [elixir-lang/tree-sitter-elixir](https://github.com/elixir-lang/tree-sitter-elixir)                             | Apache-2.0, Copyright 2021 The Elixir Team                                                                        |
| go         | [zed-industries/tree-sitter-go](https://github.com/zed-industries/tree-sitter-go)                               | MIT, Copyright (c) 2014 Max Brunsfeld                                                                             |
| java       | [tree-sitter/tree-sitter-java](https://github.com/tree-sitter/tree-sitter-java)                                 | MIT, Copyright (c) 2017 Ayman Nadeem                                                                              |
| javascript | [tree-sitter/tree-sitter-javascript](https://github.com/tree-sitter/tree-sitter-javascript), its 0.23.1 release | MIT, Copyright (c) 2014 Max Brunsfeld                                                                             |
| kotlin     | [fwcd/tree-sitter-kotlin](https://github.com/fwcd/tree-sitter-kotlin)                                           | MIT, Copyright (c) 2019 fwcd                                                                                      |
| php        | [tree-sitter/tree-sitter-php](https://github.com/tree-sitter/tree-sitter-php)                                   | MIT, Copyright (c) 2017 Josh Vera, GitHub, (c) 2019 Max Brunsfeld, Amaan Qureshi, Christian Frøystad, Caleb White |
| python     | [tree-sitter/tree-sitter-python](https://github.com/tree-sitter/tree-sitter-python)                             | MIT, Copyright (c) 2016 Max Brunsfeld                                                                             |
| ruby       | [tree-sitter/tree-sitter-ruby](https://github.com/tree-sitter/tree-sitter-ruby)                                 | MIT, Copyright (c) 2016 Rob Rix                                                                                   |
| rust       | [tree-sitter/tree-sitter-rust](https://github.com/tree-sitter/tree-sitter-rust)                                 | MIT, Copyright (c) 2017 Maxim Sokolov                                                                             |
| swift      | [alex-pinkus/tree-sitter-swift](https://github.com/alex-pinkus/tree-sitter-swift)                               | MIT, Copyright (c) 2021 alex-pinkus                                                                               |
| typescript | [zed-industries/tree-sitter-typescript](https://github.com/zed-industries/tree-sitter-typescript)               | MIT, Copyright (c) 2017 Max Brunsfeld                                                                             |

Each comes from its grammar's repository at the commit `grammars.json` pins, as its header says, and
JavaScript's from the release the TypeScript grammars build on. Elixir's is under the Apache License
in `LICENSE-APACHE`, and the rest under the MIT License, with each file's copyright line:

> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
> associated documentation files (the "Software"), to deal in the Software without restriction,
> including without limitation the rights to use, copy, modify, merge, publish, distribute,
> sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or
> substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
> NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
> NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
> DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT
> OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

`lo-tags.scm` and `imports.scm` are Lo's own. The `tags.scm` files are as their sources have them,
apart from these changes, which each changed file's header notes:

- Kotlin's tagged interfaces as classes, and every property as a constant, the local ones in a
  function's body too. It tags interfaces as interfaces, and only the properties at the top of a
  file and in a class's or object's body, a `val` as a constant and a `var` as a variable.
- Rust's tagged the functions in a module's block, `mod inner { … }`, as methods, as it does those
  in an `impl` or a trait. Only those are methods.
- Swift's tagged each member of a type with the whole type, and every constant and variable as a
  property, the local ones too. Each member is tagged with its own declaration, an enum's as well as
  a class's or struct's, and only the properties of a type and at the top of a file.

`src/tags.test.ts` compiles each language's tags against its grammar and checks that each capture is
one a tag can have; `src/samples.test.ts` reads each language's sample in `test/tags/`.
