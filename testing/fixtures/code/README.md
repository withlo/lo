# Code fixture projects

A small project in each language Lo has a syntax index for, which count and summarize words. They
are the head of the pull request `testing/fixtures/code.sh` makes in rozed-dev/e2e, and the
projects the language servers' live check asks questions of.

| Folder       | Language   | Needs installed                            |
| ------------ | ---------- | ------------------------------------------ |
| `typescript` | TypeScript | nothing                                    |
| `javascript` | JavaScript | nothing                                    |
| `python`     | Python     | nothing                                    |
| `rust`       | Rust       | a Rust toolchain                           |
| `go`         | Go         | Go 1.24 or later                           |
| `terraform`  | Terraform  | nothing                                    |
| `java`       | Java       | a JDK                                      |
| `kotlin`     | Kotlin     | a JDK                                      |
| `csharp`     | C#         | the .NET SDK, 10 or later (`Sample.csproj`) |
| `ruby`       | Ruby       | Ruby                                       |
| `php`        | PHP        | PHP                                        |
| `swift`      | Swift      | Xcode or a Swift toolchain                 |
| `elixir`     | Elixir     | nothing: it has the syntax index only      |

Every project has the same shape:

- `words` defines `countWords` (`count_words` or `CountWords`, by the language's habit), documented,
  and `Tally`, a type with `add` and in most `top`. In Terraform, `locals.tf` defines `total` and
  `variables.tf` the variable it counts. It's the file the pull request leaves alone, so `gd` goes
  to a definition the diff doesn't hold.
- `report` calls them from `summarize`, and `main` runs it. The pull request adds both, except in
  TypeScript and Python, where it changes `report`, and in Rust, where it also changes `lib.rs`.
- TypeScript and Python also have `layout`, which holds `wrap`. The pull request moves `wrap` there
  from `report`: that's the moved code `gm` goes between.

Each is a project its language's tools open as it is: `tsconfig.json`, `jsconfig.json`,
`Cargo.toml`, `go.mod`, `Package.swift`, `Sample.csproj`, `composer.json`, and Gradle's
`settings.gradle.kts` and `build.gradle.kts` for Kotlin. Java, Python, Ruby and Terraform need no
build file. None has a dependency. Kotlin's build needs the Kotlin Gradle plugin, though, which
Gradle downloads; the rest need nothing from a registry to build.

`cases.json` says what to ask. For each language, `at` is a call of `countWords` in `report` and
`definition` is where `words` defines it, each with a `line` and a `character` counted from 0, as
the language server protocol counts them. `moves` lists the moved code: its name, the file it left
and the file it went to. A test reads each place back out of the files, so an edit that moves one
fails it.

Nothing in these folders may be something a tool in this repository, or a language server, would
run or read as a setting: no `package.json`, wrapper, `node_modules`, interpreter or version file.
`code-hostile.sh` writes those, as text, on top of these projects in a pull request of its own, and
a test checks that none is here.
