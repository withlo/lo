# Queries

Each language's `highlights.scm` and `injections.scm` come from one of two places, as each file's
header says. Those of Bash, CSS, Go, JavaScript, JSON, JSONC, Markdown, Python, Rust, TSX,
TypeScript and YAML come from the grammar's own repository, at the commit `grammars.json` pins. The
others come from [Zed](https://github.com/zed-industries/zed) itself at
[`c84af5b99cbc366d675064e52b23664a015b6e35`](https://github.com/zed-industries/zed/tree/c84af5b99cbc366d675064e52b23664a015b6e35),
its 1.27.0 release, for HTML, or from the extension Zed's extension registry installs for the
language, at the commit the registry pins, and `grammars.json` pins each of those grammars to the
commit the extension's `extension.toml` names. Their capture names match the `lo-syn-*` tokens in
`design/css/code.css`, or `src/tokens.ts` maps them to one. Where a grammar's repository has no
`injections.scm`, as Bash, CSS, Go, JSON, Python and YAML's don't, the language has none.

| Queries                     | Source                                                                                                                                                                                                                                                                                         | License                                                                      |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| bash                        | [tree-sitter/tree-sitter-bash](https://github.com/tree-sitter/tree-sitter-bash) at `a06c2e4415e9bc0346c6b86d401879ffb44058f7`                                                                                                                                                                  | MIT, Copyright (c) 2017 Max Brunsfeld                                        |
| css                         | [tree-sitter/tree-sitter-css](https://github.com/tree-sitter/tree-sitter-css) at `c0d581e32d183a536731ed6c3a72758b27e20411`                                                                                                                                                                    | MIT, Copyright (c) 2018 Max Brunsfeld                                        |
| go                          | [zed-industries/tree-sitter-go](https://github.com/zed-industries/tree-sitter-go) at `6862a49e3c5a7567a6c576420e9a8f944e198a85`                                                                                                                                                                | MIT, Copyright (c) 2014 Max Brunsfeld                                        |
| javascript, tsx, typescript | [zed-industries/tree-sitter-typescript](https://github.com/zed-industries/tree-sitter-typescript) at `e2c53597d6a5d9cf7bbe8dccde576fe1e46c5899`, and [tree-sitter/tree-sitter-javascript](https://github.com/tree-sitter/tree-sitter-javascript) at `3a837b6f3658ca3618f2022f8707e29739c91364` | MIT, Copyright (c) 2017 Max Brunsfeld; Copyright (c) 2014 Max Brunsfeld      |
| json, jsonc                 | [tree-sitter/tree-sitter-json](https://github.com/tree-sitter/tree-sitter-json) at `ee35a6ebefcef0c5c416c0d1ccec7370cfca5a24`                                                                                                                                                                  | MIT, Copyright (c) 2014 Max Brunsfeld                                        |
| markdown, markdown-inline   | [zed-industries/tree-sitter-markdown](https://github.com/zed-industries/tree-sitter-markdown) at `b596e737286780d7bfa9fcddceaeeb754574b352`                                                                                                                                                    | MIT, Copyright (c) 2021 Matthias Deiml                                       |
| python                      | [tree-sitter/tree-sitter-python](https://github.com/tree-sitter/tree-sitter-python) at `293fdc02038ee2bf0e2e206711b69c90ac0d413f`                                                                                                                                                              | MIT, Copyright (c) 2016 Max Brunsfeld                                        |
| rust                        | [tree-sitter/tree-sitter-rust](https://github.com/tree-sitter/tree-sitter-rust) at `77a3747266f4d621d0757825e6b11edcbf991ca5`                                                                                                                                                                  | MIT, Copyright (c) 2017 Maxim Sokolov                                        |
| yaml                        | [zed-industries/tree-sitter-yaml](https://github.com/zed-industries/tree-sitter-yaml) at `baff0b51c64ef6a1fb1f8390f3ad6015b83ec13a`                                                                                                                                                            | MIT, Copyright (c) 2024 tree-sitter-grammars contributors, (c) 2019-2021 Ika |
| html                        | [Zed](https://github.com/zed-industries/zed), `extensions/html`                                                                                                                                                                                                                                | Apache-2.0, Copyright 2022 - 2025 Zed Industries, Inc.                       |
| csharp                      | [zed-extensions/csharp](https://github.com/zed-extensions/csharp) at `88597e19d1323c7c4c3385093d9cdcb4ee78513e`                                                                                                                                                                                | Apache-2.0, Copyright 2022-2024 Zed Industries, Inc.                         |
| elixir                      | [zed-extensions/elixir](https://github.com/zed-extensions/elixir) at `f02229c005cfee90f54be99ec1943d455049668e`                                                                                                                                                                                | Apache-2.0, Copyright 2022-2024 Zed Industries, Inc.                         |
| java                        | [zed-extensions/java](https://github.com/zed-extensions/java) at `2facaa7c4038d0b2dc8204e4b44b7a7c81405564`                                                                                                                                                                                    | Apache-2.0, the Java extension's contributors                                |
| kotlin                      | [zed-extensions/kotlin](https://github.com/zed-extensions/kotlin) at `e94974ea06f6494f003efc3161691a59ea1b3300`                                                                                                                                                                                | MIT, Copyright (c) 2024 Evren Sen                                            |
| php                         | [zed-extensions/php](https://github.com/zed-extensions/php) at `6768398bea34ea3b2ad590ac8081eb6c1ce6bf29`                                                                                                                                                                                      | Apache-2.0, Copyright 2022 - 2025 Zed Industries, Inc.                       |
| ruby                        | [zed-extensions/ruby](https://github.com/zed-extensions/ruby) at `13ebcebfad082ec3942ea23952d6a97437ee11a9`                                                                                                                                                                                    | Apache-2.0, Copyright 2022 - 2024 Zed Industries, Inc.                       |
| swift                       | [zed-extensions/swift](https://github.com/zed-extensions/swift) at `302c7978f1bc3d512960531ce11000ca333d5268`                                                                                                                                                                                  | Apache-2.0, the Swift extension's authors                                    |
| hcl, terraform              | [zed-extensions/terraform](https://github.com/zed-extensions/terraform) at `99bcfa52db879b6f71b803307a9640e04e336623`                                                                                                                                                                          | Apache-2.0, Copyright 2022-2024 Zed Industries, Inc.                         |
| toml                        | [zed-extensions/toml](https://github.com/zed-extensions/toml) at `8e18e5045841f0f265f9c8b89f138c7f7dd09e2e`                                                                                                                                                                                    | Apache-2.0, Copyright 2022-2025 Zed Industries, Inc.                         |

The Apache License 2.0 is in [`LICENSE-APACHE`](LICENSE-APACHE). The Kotlin and Terraform queries
say they're based on [nvim-treesitter](https://github.com/nvim-treesitter/nvim-treesitter)'s, and
the Markdown queries that they're from it, which are under the Apache License 2.0 too. The MIT
queries, the grammars' and Kotlin's, are each under the MIT License with the copyright line its row
here gives, which is also in its file's header. As the Kotlin queries' notice has it:

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

- Lo lets the later of two patterns that capture a node win. Go's, JSON's and CSS's queries put a
  more specific pattern before the generic one it should win over, so each moves them: Go's
  identifier patterns come first, JSON's and JSONC's string pattern comes before their key pattern,
  and CSS's pseudo-class and pseudo-element patterns come after its patterns for names.
- TypeScript's and TSX's `highlights.scm` take JavaScript's queries, as their grammar's
  `tree-sitter.json` says, with JSX's for TSX. They're written as one file each, with JavaScript's
  first and the TypeScript patterns after, so that they win where both match a node. JavaScript is
  parsed with the TSX grammar and has TSX's.
- Markdown's `highlights.scm` doesn't capture a whole fenced code block as `@text.literal`. The
  grammar takes that style from the code with `@none`, which Lo ignores, so the code would keep it
  wherever its own language leaves the text plain.
- Elixir's `highlights.scm` and `injections.scm` had patterns whose predicates name a capture that
  only some of their alternatives have. web-tree-sitter fails a predicate on a capture a match
  lacks, where tree-sitter's own library passes it, so those patterns never matched. Each is split
  in two: one pattern for the alternatives with the capture, with its predicate, and one for the
  rest.

## How they're read

`src/queries.test.ts` compiles every query against its grammar and checks that each capture has a
token or is meant to have none. A few queries use other capture names, such as Kotlin's `@float` and
`@parameter` and the grammars' `@escape` and `@text.title`, which `src/tokens.ts` maps to the tokens
they mean. Injections may name their language and text with tree-sitter's `injection.` captures and
properties, or with the older names without it (`@content`, `(#set! "language" "regex")`), as
Kotlin's and Ruby's do, and name a language as its grammar does, so `markdown_inline` is another
name for `markdown-inline`. Predicates web-tree-sitter doesn't know, such as Swift's `#lua-match?`,
are ignored.

To update them, copy the same files from the grammar's repository at the commit `grammars.json`
pins, or from a newer Zed release or extension with `grammars.json`'s commits moved to the ones it
names, and run the build and the tests.

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
