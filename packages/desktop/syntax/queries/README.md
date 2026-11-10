# Highlight queries

Each language's `highlights.scm` and `injections.scm` come from
[Zed](https://github.com/zed-industries/zed)'s `crates/grammars/src` at
[`c84af5b99cbc366d675064e52b23664a015b6e35`](https://github.com/zed-industries/zed/tree/c84af5b99cbc366d675064e52b23664a015b6e35/crates/grammars/src),
its 1.27.0 release, under the GPL-3.0-or-later. Zed's capture names are the ones the `lo-syn-*`
tokens in `design/css/code.css` are named after, and `grammars.json` pins each grammar to the commit
these queries were written for.

They're Zed's, apart from one change: the JSDoc injection's `#match?` used Rust's `(?s)` flag, which
JavaScript's regular expressions don't have, so it matches any character with `[\s\S]` instead.

`src/queries.test.ts` compiles every query against its grammar and checks that each capture has a
token or is meant to have none. To update them, copy the same files from a newer Zed release, move
`grammars.json`'s commits to the ones its `Cargo.toml` names, and run the build and the tests.
