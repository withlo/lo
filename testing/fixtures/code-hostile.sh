#!/usr/bin/env bash
# The pull request whose files try to run code, steer a language server or a version manager, or
# fetch from the network, for Lo's tests of what a language server on a trusted checkout must not
# do: `code/hostile` into `code/base`, in GitHub's rozed-dev/e2e test repository.
#
#   LO_FIXTURE_TOKEN_FILE=<file holding rozed-bot's token> bash testing/fixtures/code-hostile.sh
#   bash testing/fixtures/code-hostile.sh --local <folder>
#
# The first makes the commits and, as rozed-bot, pushes `code/base` and `code/hostile` (replacing any
# branch of those names), opens the pull request if it isn't open, and prints its number. It checks
# the token's account first and writes nowhere but rozed-dev/e2e. The second reads no network and
# needs no token: it makes, in <folder>, `rozed-dev/e2e.git` with `code/base`, `code/feature`,
# `code/fork` and `code/hostile`, and each head again as `refs/pull/<number>/head`, as `code.sh
# --local` does, and `work`.
#
# `code/hostile` is the code fixture's pull request (`code.sh`: a small project in each language,
# with `report` and `main` calling the definitions in `words`) and one commit on it that plants what
# follows. A reader of the pull request sees the code fixture's changes and the planted files, and
# a language server started on its checkout has a project of each language to answer on.
#
# What it plants is data. This file only writes it, as text, into the pull request's commits: none
# of it is in Lo's own repository as a file, so no tool of Lo's reads or runs it, and the tests
# only read what this script wrote, never run it.
#
# Every attempt either writes a marker or calls a host. A marker is an empty file named
# `lo-hostile-<name>`, written beside the program that wrote it and so inside the checkout, whatever
# folder that program ran in. A host ends in `.lo-hostile.invalid`, which can't resolve, so a
# request to one reaches nothing but a proxy's log. Where a file can name only a version, not a
# host, the host is the tool's own download host. Nothing here deletes, reads, sends or leaves
# anything beyond its own folder. A check that no attempt ran looks for:
#
#   find <checkout> -name 'lo-hostile-*'    and    a proxy log with no *.lo-hostile.invalid
#
# The attempts, with where each is, what would run it, and what shows it:
#
#   workspace TypeScript, a program and a library
#     node_modules/typescript/lib/{tsserver,typescript,tsserverlibrary}.js
#     a language server that starts the TypeScript a project has; marker lo-hostile-tsserver, in
#     lib/, and lo-hostile-typescript, for the library
#   tsserver plugin
#     typescript/node_modules/hostile-plugin, named by `plugins` in typescript/tsconfig.json
#     tsserver, loading the plugin; marker lo-hostile-tsplugin, in the plugin's folder
#   npm
#     typescript/package.json, lo-postinstall.sh and .npmrc
#     a dependency install, which Lo never does; marker typescript/lo-hostile-postinstall, and
#     host npm.lo-hostile.invalid
#   an editor's settings
#     .vscode/settings.json, naming .vscode/lo-server.sh for every server
#     a client that reads a repository's editor settings; marker .vscode/lo-hostile-vscode
#   Python's interpreter
#     python/pyrightconfig.json naming python/venv, whose bin/python and bin/python3 are scripts
#     Pyright asking the interpreter for its search paths; marker python/venv/bin/lo-hostile-python
#   Rust's compiler wrapper
#     rust/.cargo/config.toml, `build.rustc-wrapper`, naming rust/lo-rustc-wrapper.sh
#     cargo, checking a crate; marker rust/lo-hostile-rustc-wrapper
#   Rust's toolchain
#     rust/rust-toolchain.toml, asking for Rust 99.0.0
#     rustup, which would download it; no marker, a request to static.rust-lang.org
#   Go's toolchain
#     go/go.mod, a `toolchain` line asking for Go 1.99.9
#     go, which would download it; no marker, a request to proxy.golang.org
#   Gradle's wrapper
#     kotlin/gradlew and kotlin/gradle/wrapper/gradle-wrapper.properties
#     running the wrapper; marker kotlin/lo-hostile-gradlew, and host gradle.lo-hostile.invalid
#   Maven's wrapper
#     java/mvnw and java/.mvn/wrapper/maven-wrapper.properties
#     running the wrapper; marker java/lo-hostile-mvnw, and host maven-dist.lo-hostile.invalid
#   Phpactor's tools
#     php/.phpactor.json, naming php/lo-tool.sh as PHPStan, Psalm and PHP CS Fixer
#     Phpactor, checking a file; marker php/lo-hostile-phpactor
#   versions that don't exist
#     .tool-versions, .nvmrc, python/.python-version, ruby/.ruby-version, csharp/global.json
#     a version manager or `dotnet` choosing a version from the checkout; no marker, a request to
#     the version's download host, or an error
#   mise
#     mise.toml, sourcing lo-mise-env.sh when it enters the folder (mise runs it only in a
#     configuration it trusts); marker lo-hostile-mise
#   git, in folders of git/ that look like bare repositories, which git opens when a tool runs it
#   inside one, unless `safe.bareRepository` is `explicit`
#     git/fsmonitor, `core.fsmonitor` naming lo-fsmonitor.sh; run by `git status`; marker
#       git/fsmonitor/lo-hostile-fsmonitor
#     git/hook, hooks that git runs when it updates the index or a ref, checks out, commits or
#       collects garbage; marker git/hook/hooks/lo-hostile-hook
#     git/filter, a clean and smudge filter on every file; run by `git add` and `git diff`; marker
#       git/filter/lo-hostile-filter. The root .gitattributes names the same filter, which nothing
#       in a checkout can define
#   dependencies and registries on hosts that don't exist, each a project of its own in hostile/ so
#   that the code fixture's projects load whatever is refused
#     hostile/{maven,gradle,cargo,go,dotnet,ruby,php,terraform,swift}
#     a package manager resolving them, which Lo never lets one do; hosts maven, gradle-plugins,
#     gradle, cargo, nuget, rubygems, composer, registry, git and swift .lo-hostile.invalid, and
#     the module lo-hostile.invalid/dependency for Go

# `scratch`, `work` and `pull` are set by code-lib.sh's functions and by `main`.
# shellcheck disable=SC2154

set -euo pipefail

# The pull request's number on GitHub.
CODE_HOSTILE_PULL=100

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=testing/fixtures/code.sh
. "$here/code.sh"

HOSTILE_TITLE='Code fixture: files that try to run code'
IFS= read -r -d '' HOSTILE_BODY <<'EOF' || true
**A test fixture for Lo's trust handling, not code to run or merge.** `testing/fixtures/code-hostile.sh` in withlo/lo makes every commit of it.

It's the code fixture's pull request, with one more commit. That commit's files try to run code, steer a language server or a version manager, or fetch from the network, when the pull request is checked out and its servers start:

- programs a tool might run: a workspace TypeScript in `node_modules`, a tsserver plugin in `typescript/node_modules`, an npm `postinstall`, `.vscode/settings.json`, the interpreter `python/pyrightconfig.json` names, a `rustc-wrapper` in `rust/.cargo/config.toml`, the Gradle and Maven wrappers, `php/.phpactor.json`'s tools, and `mise.toml`;
- versions that don't exist: `.tool-versions`, `.nvmrc`, `python/.python-version`, `ruby/.ruby-version`, `rust-toolchain.toml`, `go.mod`'s `toolchain` and `global.json`;
- git's own settings, in three folders of `git/` that look like bare repositories: a `core.fsmonitor` program, hooks, and a clean and smudge filter;
- projects in `hostile/` whose dependencies or registries are on hosts ending `.lo-hostile.invalid`, which never resolve.

Each program writes one empty file named `lo-hostile-<name>` beside itself, and nothing else: no network, no deletes, no reads. Lo passes while no `lo-hostile-*` file appears in the checkout and no request goes to a host ending `.lo-hostile.invalid`, or to the download host of a version that doesn't exist.

It targets `code/base`, so merging it can't put these files on `main`.
EOF

# Writes <path>, a program that writes the empty marker <marker> beside itself, and fails.
# <what> says what it stands for.
marker_sh() {
  put_exec "$1" <<EOF
#!/bin/sh
# Fixture: $3. Writes the empty file $2 beside itself, and nothing else.
: >"\$(dirname "\$0")/$2"
exit 1
EOF
}

# Writes <path>, a CommonJS file that writes the empty marker <marker> beside itself, and throws.
marker_js() {
  put "$1" <<EOF
// Fixture: $3. Writes the empty file $2 beside itself, and nothing else.
require('node:fs').writeFileSync(require('node:path').join(__dirname, '$2'), '');
throw new Error('$2');
EOF
}

# Writes <folder>, which git opens as a repository whose work tree is the folder itself, as far as
# `git` goes when it's run inside it. `objects/.keep` and `refs/.keep` are there so the folders
# exist: git keeps no empty folder, and git opens none without them.
plant_repository() {
  local folder=$1
  put "$folder/HEAD" <<'EOF'
ref: refs/heads/main
EOF
  put "$folder/objects/.keep" </dev/null
  put "$folder/refs/.keep" </dev/null
}

# Makes `code/hostile` in the working copy, on `code/feature`.
build_hostile() {
  local hook

  g switch -q -c code/hostile

  # --- Programs a tool might run ----------------------------------------------------------------

  # A workspace TypeScript: the server, and the library a server loads.
  put node_modules/typescript/package.json <<'EOF'
{
  "name": "typescript",
  "version": "99.0.0",
  "main": "./lib/typescript.js"
}
EOF
  marker_js node_modules/typescript/lib/tsserver.js lo-hostile-tsserver \
    "a workspace TypeScript's server"
  marker_js node_modules/typescript/lib/typescript.js lo-hostile-typescript \
    "a workspace TypeScript's library"
  marker_js node_modules/typescript/lib/tsserverlibrary.js lo-hostile-typescript \
    "a workspace TypeScript's server library"

  # A tsserver plugin, which `plugins` in tsconfig.json names.
  put typescript/node_modules/hostile-plugin/package.json <<'EOF'
{
  "name": "hostile-plugin",
  "version": "1.0.0",
  "main": "index.js"
}
EOF
  put typescript/node_modules/hostile-plugin/index.js <<'EOF'
// Fixture: a tsserver plugin. Writes the empty file lo-hostile-tsplugin beside itself, and nothing else.
module.exports = function init() {
  require('node:fs').writeFileSync(require('node:path').join(__dirname, 'lo-hostile-tsplugin'), '');
  return { create: (info) => info.languageService };
};
EOF
  put typescript/tsconfig.json <<'EOF'
{
  "compilerOptions": {
    "target": "es2022",
    "lib": ["es2022", "dom"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "strict": true,
    "types": [],
    "plugins": [{ "name": "hostile-plugin" }]
  },
  "include": ["src"]
}
EOF

  # An npm install: a script, and a registry that doesn't exist.
  put typescript/package.json <<'EOF'
{
  "name": "hostile-typescript",
  "private": true,
  "scripts": {
    "postinstall": "sh ./lo-postinstall.sh"
  },
  "dependencies": {
    "hostile-dependency": "1.0.0"
  }
}
EOF
  put typescript/.npmrc <<'EOF'
registry=https://npm.lo-hostile.invalid/
EOF
  marker_sh typescript/lo-postinstall.sh lo-hostile-postinstall "an npm install script"

  # An editor's settings, which name one program for every server.
  put .vscode/settings.json <<'EOF'
{
  "typescript.tsdk": "node_modules/typescript/lib",
  "typescript.tsserver.pluginPaths": ["typescript/node_modules"],
  "python.defaultInterpreterPath": ".vscode/lo-server.sh",
  "rust-analyzer.server.path": ".vscode/lo-server.sh",
  "go.alternateTools": {
    "go": ".vscode/lo-server.sh",
    "gopls": ".vscode/lo-server.sh"
  },
  "terraform.languageServer.path": ".vscode/lo-server.sh"
}
EOF
  marker_sh .vscode/lo-server.sh lo-hostile-vscode "a program an editor's settings name"

  # Pyright's interpreter: pyrightconfig.json names a virtual environment, whose interpreter
  # Pyright runs to ask for its search paths.
  put python/pyrightconfig.json <<'EOF'
{
  "venvPath": ".",
  "venv": "venv"
}
EOF
  put python/venv/pyvenv.cfg <<'EOF'
home = bin
include-system-site-packages = false
version = 3.12.0
EOF
  marker_sh python/venv/bin/python lo-hostile-python "a virtual environment's interpreter"
  marker_sh python/venv/bin/python3 lo-hostile-python "a virtual environment's interpreter"

  # Cargo's wrapper around rustc, which a crate's config names, relative to the crate.
  put rust/.cargo/config.toml <<'EOF'
[build]
rustc-wrapper = "./lo-rustc-wrapper.sh"
EOF
  marker_sh rust/lo-rustc-wrapper.sh lo-hostile-rustc-wrapper "a wrapper around the Rust compiler"

  # The Gradle and Maven wrappers: scripts, and the distributions they would download.
  put kotlin/gradle/wrapper/gradle-wrapper.properties <<'EOF'
distributionBase=GRADLE_USER_HOME
distributionPath=wrapper/dists
distributionUrl=https\://gradle.lo-hostile.invalid/distributions/gradle-99.0-bin.zip
zipStoreBase=GRADLE_USER_HOME
zipStorePath=wrapper/dists
EOF
  marker_sh kotlin/gradlew lo-hostile-gradlew "Gradle's wrapper script"
  put java/.mvn/wrapper/maven-wrapper.properties <<'EOF'
distributionUrl=https://maven-dist.lo-hostile.invalid/maven/apache-maven-99.0-bin.zip
EOF
  marker_sh java/mvnw lo-hostile-mvnw "Maven's wrapper script"

  # The tools Phpactor runs on a file, which its configuration names.
  put php/.phpactor.json <<'EOF'
{
  "language_server_phpstan.enabled": true,
  "language_server_phpstan.bin": "%project_root%/lo-tool.sh",
  "language_server_psalm.enabled": true,
  "language_server_psalm.bin": "%project_root%/lo-tool.sh",
  "language_server_php_cs_fixer.enabled": true,
  "language_server_php_cs_fixer.bin": "%project_root%/lo-tool.sh"
}
EOF
  marker_sh php/lo-tool.sh lo-hostile-phpactor "a tool Phpactor's configuration names"

  # mise: its config sources a script, which mise runs only in a configuration it trusts.
  put mise.toml <<'EOF'
[tools]
node = "99.0.0"
python = "99.0.0"

[env]
_.source = "./lo-mise-env.sh"

[hooks]
enter = "sh ./lo-mise-env.sh"
EOF
  marker_sh lo-mise-env.sh lo-hostile-mise "a script mise's configuration sources"

  # --- Versions that don't exist ---------------------------------------------------------------

  put .tool-versions <<'EOF'
nodejs 99.0.0
python 99.0.0
ruby 99.0.0
golang 99.0.0
java temurin-99.0.0
EOF
  put .nvmrc <<'EOF'
99
EOF
  put python/.python-version <<'EOF'
3.99
EOF
  put ruby/.ruby-version <<'EOF'
9.9.9
EOF
  put rust/rust-toolchain.toml <<'EOF'
[toolchain]
channel = "99.0.0"
profile = "minimal"
EOF
  put go/go.mod <<'EOF'
module example.com/sample

go 1.24

toolchain go1.99.9
EOF
  put csharp/global.json <<'EOF'
{
  "sdk": {
    "version": "8.0.100",
    "rollForward": "latestMajor",
    "allowPrerelease": true
  }
}
EOF

  # --- Git's own settings ----------------------------------------------------------------------

  # The root's attributes name a filter that nothing in a checkout can define.
  put .gitattributes <<'EOF'
* filter=lo-hostile
EOF

  # A program git runs to ask what changed, which `core.fsmonitor` names.
  plant_repository git/fsmonitor
  put git/fsmonitor/config <<'EOF'
[core]
	repositoryformatversion = 0
	bare = false
	worktree = .
	fsmonitor = ./lo-fsmonitor.sh
EOF
  marker_sh git/fsmonitor/lo-fsmonitor.sh lo-hostile-fsmonitor "a program git's fsmonitor setting names"

  # Hooks, which git runs when it updates the index or a ref, checks out, commits or collects
  # garbage.
  plant_repository git/hook
  put git/hook/config <<'EOF'
[core]
	repositoryformatversion = 0
	bare = false
	worktree = .
EOF
  for hook in post-index-change reference-transaction post-checkout post-merge pre-commit pre-auto-gc; do
    marker_sh "git/hook/hooks/$hook" lo-hostile-hook "git's $hook hook"
  done

  # A filter on every file, which git runs to clean a file it adds and smudge one it checks out.
  plant_repository git/filter
  put git/filter/config <<'EOF'
[core]
	repositoryformatversion = 0
	bare = false
	worktree = .
[filter "lo-hostile"]
	clean = ./lo-filter.sh
	smudge = ./lo-filter.sh
EOF
  put git/filter/info/attributes <<'EOF'
* filter=lo-hostile
EOF
  put git/filter/data.txt <<'EOF'
A file the filter would run on.
EOF
  marker_sh git/filter/lo-filter.sh lo-hostile-filter "a clean and smudge filter git's configuration names"

  # --- Dependencies and registries that don't exist --------------------------------------------

  put hostile/maven/pom.xml <<'EOF'
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <groupId>lo.hostile</groupId>
  <artifactId>maven</artifactId>
  <version>1.0.0</version>
  <repositories>
    <repository>
      <id>lo-hostile</id>
      <url>https://maven.lo-hostile.invalid/repository</url>
    </repository>
  </repositories>
  <dependencies>
    <dependency>
      <groupId>lo.hostile</groupId>
      <artifactId>dependency</artifactId>
      <version>1.0.0</version>
    </dependency>
  </dependencies>
</project>
EOF

  put hostile/gradle/settings.gradle.kts <<'EOF'
pluginManagement {
    repositories {
        maven("https://gradle-plugins.lo-hostile.invalid/repository")
    }
}

rootProject.name = "hostile"
EOF
  put hostile/gradle/build.gradle.kts <<'EOF'
plugins {
    id("lo.hostile.plugin") version "1.0.0"
}

repositories {
    maven("https://gradle.lo-hostile.invalid/repository")
}

dependencies {
    implementation("lo.hostile:dependency:1.0.0")
}
EOF

  put hostile/cargo/Cargo.toml <<'EOF'
[package]
name = "hostile"
version = "0.1.0"
edition = "2021"

[dependencies]
hostile-dependency = { version = "1", registry = "lo-hostile" }
EOF
  put hostile/cargo/.cargo/config.toml <<'EOF'
[registries.lo-hostile]
index = "sparse+https://cargo.lo-hostile.invalid/index/"
EOF
  put hostile/cargo/src/lib.rs <<'EOF'
pub fn hostile() {}
EOF

  put hostile/go/go.mod <<'EOF'
module example.com/hostile

go 1.24

require lo-hostile.invalid/dependency v1.0.0
EOF
  put hostile/go/main.go <<'EOF'
package main

import _ "lo-hostile.invalid/dependency"

func main() {}
EOF

  put hostile/dotnet/Hostile.csproj <<'EOF'
<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net10.0</TargetFramework>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="Lo.Hostile.Dependency" Version="1.0.0" />
  </ItemGroup>

</Project>
EOF
  put hostile/dotnet/NuGet.config <<'EOF'
<configuration>
  <packageSources>
    <clear />
    <add key="lo-hostile" value="https://nuget.lo-hostile.invalid/v3/index.json" />
  </packageSources>
</configuration>
EOF
  put hostile/dotnet/Program.cs <<'EOF'
System.Console.WriteLine("hostile");
EOF

  put hostile/ruby/Gemfile <<'EOF'
source 'https://rubygems.lo-hostile.invalid'

gem 'hostile-dependency'
EOF

  put hostile/php/composer.json <<'EOF'
{
  "name": "lo-hostile/php",
  "repositories": [
    { "type": "composer", "url": "https://composer.lo-hostile.invalid" }
  ],
  "require": {
    "lo-hostile/dependency": "1.0.0"
  }
}
EOF

  put hostile/terraform/main.tf <<'EOF'
terraform {
  required_providers {
    hostile = {
      source = "registry.lo-hostile.invalid/lo/hostile"
    }
  }
}

module "hostile" {
  source = "git::https://git.lo-hostile.invalid/lo/module.git"
}
EOF

  put hostile/swift/Package.swift <<'EOF'
// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "Hostile",
    dependencies: [
        .package(url: "https://swift.lo-hostile.invalid/lo/dependency.git", from: "1.0.0")
    ],
    targets: [
        .executableTarget(
            name: "Hostile",
            dependencies: [.product(name: "Dependency", package: "dependency")],
            path: "Sources"
        )
    ]
)
EOF
  put hostile/swift/Sources/main.swift <<'EOF'
print("hostile")
EOF

  commit 'Plant what a language server must ignore' 2026-11-15T09:20:00Z
}

# Pushes the branches, and opens the pull request. Sets `hostile_pull`.
publish_hostile() {
  push_to "$E2E_REPO" code/base:refs/heads/code/base code/hostile:refs/heads/code/hostile
  ensure_pull code/hostile code/base "$HOSTILE_TITLE" "$HOSTILE_BODY"
  hostile_pull=$pull
  expect_pull "$hostile_pull" "$CODE_HOSTILE_PULL" CODE_HOSTILE_PULL
}

main() {
  local folder
  case ${1-} in
    '')
      code_setup
      work=$scratch/work
      code_login code-hostile.sh
      build_code
      build_hostile
      publish_hostile
      echo "the hostile fixture is $E2E_REPO#$hostile_pull"
      ;;
    --local)
      folder=${2:?usage: bash testing/fixtures/code-hostile.sh --local <folder>}
      mkdir -p "$folder"
      folder=$(cd "$folder" && pwd)
      code_setup
      work=$folder/work
      build_code
      build_hostile
      make_bare "$folder/$E2E_REPO.git" \
        code/base:refs/heads/code/base \
        code/feature:refs/heads/code/feature \
        code/feature:refs/heads/code/fork \
        code/hostile:refs/heads/code/hostile \
        "code/feature:refs/pull/$CODE_PULL/head" \
        "code/feature:refs/pull/$CODE_FORK_PULL/head" \
        "code/hostile:refs/pull/$CODE_HOSTILE_PULL/head"
      ;;
    *)
      echo "usage: bash testing/fixtures/code-hostile.sh [--local <folder>]" >&2
      exit 2
      ;;
  esac
}

# Run, unless another script sources this one for `build_hostile` and `publish_hostile`.
if [ "${BASH_SOURCE[0]}" = "$0" ]; then main "$@"; fi
