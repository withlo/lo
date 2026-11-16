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
#   (Python has no interpreter plant: Pyright takes its interpreter from the client's settings, or
#   the `python` on PATH, and never from a file of a project. Its `venv` setting names a folder it
#   reads, not a program it runs. python/.python-version is there for `python` on PATH, below.)
#   Cargo's config, every key that `cargo metadata` and `cargo rustc --print` act on which chooses
#   a program or a flag of rustc's, or reaches the network
#     rust/.cargo/config.toml, the keys Lo's variables answer: `build.rustc`, `build.rustc-wrapper`,
#     `build.rustc-workspace-wrapper` (Lo's RUSTC and empty wrappers), `build.rustflags` and
#     `target.*.rustflags`, a `--cfg lo_hostile_rustflags` (an empty CARGO_ENCODED_RUSTFLAGS),
#     `target.*`'s runner and linker (not run by `cargo metadata`), `[source]` replacement,
#     `[registries]` and their credential-provider, `[registry]` global-credential-providers and
#     `net.offline = false` (CARGO_NET_OFFLINE)
#     .cargo/config.toml, which cargo reads in rust/ too, the keys Lo can't answer with a variable,
#     so `checkoutProblem` refuses the checkout: an `[env]` table, which cargo sets on the rustc it
#     runs; an `[unstable]` table, which takes effect since rust-analyzer runs cargo with
#     RUSTC_BOOTSTRAP=1; and an `include` of another config
#     Markers rust/lo-hostile-{rustc,rustc-wrapper,rustc-workspace-wrapper,runner,linker,cred}, and
#     hosts cargo-src, cargo-reg.lo-hostile.invalid. None runs: the checkout is refused, and the
#     live check runs rust-analyzer on it without .cargo/config.toml and rust/rust-analyzer.toml
#     too, where every key left is answered by a variable.
#   rust-analyzer's workspace settings
#     rust/rust-analyzer.toml, whose workspace-scoped keys win over Lo's client settings:
#     `cargo.extraEnv`, `cargo.buildScripts.enable` with an `overrideCommand`, a `check`
#     `overrideCommand`, and `procMacro`, naming rust/lo-rust-analyzer.sh. Lo can't send a setting
#     that overrides these, so `checkoutProblem` refuses the checkout; marker
#     rust/lo-hostile-rust-analyzer
#   Rust's toolchain
#     rust/rust-toolchain.toml, asking for Rust 99.0.0
#     rustup, which would download it; no marker, a request to static.rust-lang.org
#   Go's toolchain
#     go/go.mod, a `toolchain` line asking for Go 1.99.9, and go.work, a workspace of go/ alone
#     with the same line
#     go, which would download it; no marker, a request to proxy.golang.org
#   Go's generators and cgo
#     go/generate.go, a `//go:generate` line naming go/lo-go-generate.sh; go/cgo.go, which imports
#     "C" with a `#cgo pkg-config` line
#     `go generate`, which only a command runs; marker go/lo-hostile-go-generate. cgo, which would
#     run `pkg-config` and a C compiler from PATH, has no marker in the checkout: the live check
#     puts programs of those names on the server's PATH
#   programs on PATH
#     hostile/bin/terraform and hostile/bin/gopackagesdriver, and .envrc adding hostile/bin to
#     PATH, as direnv would
#     terraform-ls running Terraform, Go's package loader running a driver, or anything that took
#     a folder of the checkout as one of its programs'; markers hostile/bin/lo-hostile-terraform
#     and hostile/bin/lo-hostile-gopackagesdriver
#   Gradle's wrapper
#     kotlin/gradlew and kotlin/gradle/wrapper/gradle-wrapper.properties
#     running the wrapper; marker kotlin/lo-hostile-gradlew, and host gradle.lo-hostile.invalid
#   Maven's wrapper
#     java/mvnw and java/.mvn/wrapper/maven-wrapper.properties
#     running the wrapper; marker java/lo-hostile-mvnw, and host maven-dist.lo-hostile.invalid
#   Java's project, as Gradle, Maven and Eclipse import it, beside the code fixture's java/src
#     java/gradlew and java/gradle/wrapper/gradle-wrapper.properties, as Kotlin's are; marker
#       java/lo-hostile-gradlew, and host gradle.lo-hostile.invalid
#     java/settings.gradle, which runs java/lo-gradle-settings.sh, and java/build.gradle, a plugin,
#       a repository and an annotation processor; Gradle, configuring the project; marker
#       java/lo-hostile-gradle-settings, and hosts gradle-plugins and gradle.lo-hostile.invalid
#     java/gradle.properties, naming java/jdk as the JDK to build with and to find, and turning on
#       downloads; Gradle, starting its daemon; marker java/jdk/bin/lo-hostile-gradle-java
#     java/pom.xml, a repository, a plugin's, a build extension and a plugin run as sources are
#       generated, and java/.mvn/extensions.xml, a core extension; Maven or m2e, importing or
#       building; hosts maven and maven-plugins.lo-hostile.invalid
#     java/.mvn/maven.config and java/.mvn/jvm.config, a local repository and a log file in the
#       checkout; Maven's launcher; the folder java/lo-hostile-maven-repository and the file
#       java/lo-hostile-maven-jvm
#     java/.project, an external tool builder, java/.externalToolBuilders/lo.launch, which names
#       java/lo-eclipse-builder.sh, and m2e's builder; Eclipse, building; marker
#       java/lo-hostile-eclipse-builder
#     java/.classpath, java/.factorypath and java/.settings, an output folder, a Javadoc host,
#       an annotation processor and annotation processing on, generating sources; Eclipse,
#       importing or building; the folders java/lo-hostile-eclipse-output and
#       java/lo-hostile-apt-generated, and host javadoc.lo-hostile.invalid
#   the JVM's options file
#     .hotspotrc, logging the JVM's output to a file in the folder it runs in
#     a JVM started there that's told to read it, which no product build is unless told; the file
#     lo-hostile-hotspotrc
#   Phpactor's tools
#     php/.phpactor.json, naming php/lo-tool.sh as PHPStan, Psalm and PHP CS Fixer
#     Phpactor, checking a file; marker php/lo-hostile-phpactor
#   PHP's tools, as Composer installs them
#     vendor/bin/{phpcs,phpcbf,phpstan,phpmd,mago,pint,php-cs-fixer,phpunit}, at the root, where a
#     server started on the checkout runs them from
#     a server checking, formatting or testing a file; markers in vendor/bin, lo-hostile-phpcs,
#     lo-hostile-phpcbf, lo-hostile-phpstan, lo-hostile-phpmd, lo-hostile-mago, lo-hostile-pint,
#     lo-hostile-php-cs-fixer and lo-hostile-phpunit
#   php-lsp's settings
#     .php-lsp.json, turning on vendor/bin/phpstan and vendor/bin/phpcs, putting php-lsp's cache
#     in the checkout, reading code as PHP 7.4 and indexing vendor/, which holds a package's class,
#     vendor/acme/planted/src/Planted.php
#     php-lsp, taking them from the checkout; markers lo-hostile-phpstan and lo-hostile-phpcs, and
#     the folder lo-hostile-php-lsp-cache; for the rest, its log naming PHP 7.4, and a count of the
#     files it indexed that's one more than on the code fixture's checkout
#   versions that don't exist
#     .tool-versions, .nvmrc, .sdkmanrc, .java-version, python/.python-version, ruby/.ruby-version
#     a version manager choosing a version from the checkout; no marker, a request to the
#     version's download host, or an error. csharp/global.json is a version choice too, of an SDK
#     that exists, rolled forward past it: no marker and no host, and it shows only in the SDK a
#     server says it used
#   mise
#     mise.toml, sourcing lo-mise-env.sh into the environment mise makes for the folder (mise runs
#     it only in a configuration it trusts, and bash sources it, so it writes its marker by its
#     own path and not by `$0`, which is then bash's); marker lo-hostile-mise
#   a committed Terraform provider
#     hostile/terraform-provider/.terraform, and a lock file with the plugin's hash, so that
#     Terraform takes the plugin as installed
#     terraform-ls, asking Terraform for the providers' schemas; marker
#     hostile/terraform-provider/.terraform/providers/registry.terraform.io/hashicorp/null/9.9.9/
#     <platform>/lo-hostile-terraform-provider
#   SourceKit-LSP's build servers and settings
#     .bsp/lo-hostile.json and buildServer.json, each naming hostile/swift-bsp/lo-bsp.sh as a build
#     server; .sourcekit-lsp/config.json, which keeps SourceKit-LSP's generated files in the
#     checkout's lo-hostile-sourcekit-lsp, takes compile commands from hostile/swift-commands, and
#     builds packages as it indexes, outside SwiftPM's sandbox
#     SourceKit-LSP, opening the checkout as its workspace; marker
#     hostile/swift-bsp/lo-hostile-bsp, and the folder lo-hostile-sourcekit-lsp. Lo refuses a
#     checkout with any of these, and the live check runs SourceKit-LSP on it anyway
#   compile commands that load code into the compiler
#     hostile/swift-commands/compile_commands.json: for Lo.swift, a macro whose plugin is
#     lo-swift-macro.sh (`-load-plugin-executable`), and for lo.c, clang's `-Xclang -load` and
#     `-fplugin` of a library that isn't there
#     the Swift compiler expanding the macro; marker hostile/swift-commands/lo-hostile-swift-macro
#   Swift packages' manifests, and a build tool plugin
#     hostile/swift/Package.swift and hostile/swift-plugin/Package.swift, manifests that write
#     their markers as SwiftPM evaluates them; hostile/swift-plugin/Plugins/plugin.swift, a plugin
#     that writes its own and runs lo-swift-plugin.sh before each build; and each package's
#     .sourcekit-lsp/config.json, which works outside SwiftPM's sandbox, and for
#     hostile/swift-plugin builds the package as SourceKit-LSP indexes
#     SwiftPM, reading a package and building it; markers hostile/swift/lo-hostile-swift-manifest,
#     hostile/swift-plugin/lo-hostile-swift-plugin-manifest,
#     hostile/swift-plugin/Plugins/lo-hostile-swift-build-plugin and
#     hostile/swift-plugin/lo-hostile-swift-plugin
#   git, in folders of git/ that look like bare repositories, which git opens when a tool runs it
#   inside one, unless `safe.bareRepository` is `explicit`
#     git/fsmonitor, `core.fsmonitor` naming lo-fsmonitor.sh; run by `git status`; marker
#       git/fsmonitor/lo-hostile-fsmonitor
#     git/hook, hooks that git runs when it updates the index or a ref, checks out, commits or
#       collects garbage; marker git/hook/hooks/lo-hostile-hook
#     git/filter, a clean and smudge filter on every file; run by `git add` and `git diff`; marker
#       git/filter/lo-hostile-filter. The root .gitattributes names the same filter, which nothing
#       in a checkout can define
#     git/lazy, a repository whose HEAD names a commit it hasn't got, and whose only remote is a
#       promisor, so git asks for the commit; host lazy.lo-hostile.invalid, unless
#       `GIT_NO_LAZY_FETCH` is set
#     .gitmodules and a submodule `hostile/submodule`, which `git submodule update` would clone;
#       host submodule.lo-hostile.invalid
#   dependencies and registries on hosts that don't exist, each a project of its own in hostile/ so
#   that the code fixture's projects load whatever is refused
#     hostile/{maven,gradle,cargo,go,dotnet,dotnet-sdk,ruby,php,terraform,swift}
#     a package manager resolving them, which Lo never lets one do; hosts maven, gradle-plugins,
#     gradle, cargo, nuget, nuget-sdk, rubygems, composer, registry, git and swift
#     .lo-hostile.invalid, and the module lo-hostile.invalid/dependency for Go. dotnet-sdk's
#     global.json names an MSBuild SDK, which NuGet would download and MSBuild would run.
#     hostile/terraform also calls a module from the Terraform Registry, lo-hostile/module/invalid,
#     whose inputs terraform-ls asks registry.terraform.io for, whatever the module's name
#
# Automatic type acquisition has no plant: tsserver installs the typings of the packages a project
# uses from the npm registry its own settings name, never one a file of a project names.

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

- programs a tool might run: a workspace TypeScript in `node_modules`, a tsserver plugin in `typescript/node_modules`, an npm `postinstall`, `.vscode/settings.json`, a `rust/.cargo/config.toml` naming programs for `build.rustc`, its wrappers, a target's runner and linker, and a registry credential provider, and flags for rustc, a `.cargo/config.toml` with an `[env]` table, an `[unstable]` table and an `include`, the workspace settings `rust/rust-analyzer.toml` names, the Gradle and Maven wrappers, Java's Gradle settings script, a JDK in `java/jdk` that `java/gradle.properties` names, an Eclipse builder in `java/.project`, `php/.phpactor.json`'s tools, PHP's tools in `vendor/bin` and the `.php-lsp.json` that turns two of them on, build servers in `.bsp/` and `buildServer.json`, SourceKit-LSP's settings in `.sourcekit-lsp/config.json`, compile commands that load a Swift macro's plugin and clang plugins, Swift packages' manifests and a build tool plugin, `mise.toml`, a Terraform provider's plugin committed in `hostile/terraform-provider/.terraform`, a `//go:generate` line and a cgo file in `go/`, and a `terraform` and a `gopackagesdriver` in `hostile/bin`, which `.envrc` puts on `PATH`;
- settings that write in the checkout or turn on what runs: Maven's `.mvn/maven.config` and `.mvn/jvm.config`, Eclipse's `.classpath`, `.factorypath` and `.settings` in `java/`, and a `.hotspotrc`;
- versions that don't exist: `.tool-versions`, `.nvmrc`, `.sdkmanrc`, `.java-version`, `python/.python-version`, `ruby/.ruby-version`, `rust-toolchain.toml`, the `toolchain` lines of `go.mod` and `go.work`, and a `global.json` that pins an MSBuild SDK;
- git's own settings, in folders of `git/` that look like bare repositories: a `core.fsmonitor` program, hooks, a clean and smudge filter, and a promisor remote that makes git fetch a commit it lacks; and a `.gitmodules` that points a submodule at a host that doesn't exist;
- projects in `hostile/`, and Java's `pom.xml` and Gradle scripts, whose dependencies or registries are on hosts ending `.lo-hostile.invalid`, which never resolve, and a Terraform module from the Terraform Registry that doesn't exist.

Each program writes one empty file named `lo-hostile-<name>` beside itself, and nothing else: no network, no deletes, no reads. Lo passes while no `lo-hostile-*` file appears in the checkout and no request goes to a host ending `.lo-hostile.invalid`, to the download host of a version that doesn't exist, or to the Terraform Registry.

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

# Writes <path>, a script that bash sources, which writes the empty marker <marker> beside itself.
# When a shell sources a script `$0` is the shell, so the script finds itself by `BASH_SOURCE`.
marker_bash() {
  put_exec "$1" <<EOF
#!/usr/bin/env bash
# Fixture: $3. Writes the empty file $2 beside itself, and nothing else.
: >"\$(dirname "\${BASH_SOURCE[0]}")/$2"
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

# Writes hostile/terraform-provider, a Terraform project with the plugin of a provider already in
# its `.terraform`, which Terraform runs to ask for its schema, and the lock file that makes it
# take the plugin as installed: the lock holds the hash of the plugin's folder, which is `h1:` and
# the base64 of the SHA-256 of a line for each file, its own SHA-256 in hex and its name.
plant_terraform_provider() {
  local folder=hostile/terraform-provider platform plugin hash
  local name=terraform-provider-null_v9.9.9
  local installed=.terraform/providers/registry.terraform.io/hashicorp/null/9.9.9
  put "$folder/versions.tf" <<'EOF'
terraform {
  required_providers {
    null = {
      source  = "hashicorp/null"
      version = "9.9.9"
    }
  }
}
EOF
  put "$folder/main.tf" <<'EOF'
resource "null_resource" "hostile" {}
EOF
  for platform in darwin_arm64 darwin_amd64 linux_amd64 linux_arm64; do
    marker_sh "$folder/$installed/$platform/$name" lo-hostile-terraform-provider \
      "a provider's plugin that Terraform finds in .terraform"
  done
  plugin=$work/$folder/$installed/darwin_arm64/$name
  hash=$(printf '%s  %s\n' "$(openssl dgst -sha256 -r "$plugin" | cut -d' ' -f1)" "$name" |
    openssl dgst -sha256 -binary | openssl base64)
  put "$folder/.terraform.lock.hcl" <<EOF
provider "registry.terraform.io/hashicorp/null" {
  version     = "9.9.9"
  constraints = "9.9.9"
  hashes = [
    "h1:$hash",
  ]
}
EOF
}

# Makes `code/hostile` in the working copy, on `code/feature`.
build_hostile() {
  local hook tool

  g switch -q -c code/hostile

  # --- Programs a tool might run ----------------------------------------------------------------

  # A workspace TypeScript: the server, and the library a server loads.
  put node_modules/typescript/package.json <<'EOF'
{
  "name": "typescript",
  "version": "99.0.0",
  "type": "commonjs",
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
  "type": "commonjs",
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
  "python.defaultInterpreterPath": "${workspaceFolder}/.vscode/lo-server.sh",
  "rust-analyzer.server.path": "${workspaceFolder}/.vscode/lo-server.sh",
  "go.alternateTools": {
    "go": "${workspaceFolder}/.vscode/lo-server.sh",
    "gopls": "${workspaceFolder}/.vscode/lo-server.sh"
  },
  "gopls": {
    "build.env": {
      "GOFLAGS": "-toolexec=${workspaceFolder}/.vscode/lo-server.sh",
      "GOPACKAGESDRIVER": "${workspaceFolder}/.vscode/lo-server.sh"
    },
    "build.buildFlags": ["-toolexec=${workspaceFolder}/.vscode/lo-server.sh"]
  },
  "terraform.languageServer.path": "${workspaceFolder}/.vscode/lo-server.sh",
  "terraform.languageServer.terraform.path": "${workspaceFolder}/.vscode/lo-server.sh",
  "java.jdt.ls.java.home": "${workspaceFolder}/java/jdk",
  "java.jdt.ls.vmargs": "-XX:OnError=${workspaceFolder}/.vscode/lo-server.sh",
  "java.configuration.runtimes": [{ "name": "JavaSE-21", "path": "${workspaceFolder}/java/jdk" }],
  "java.import.gradle.enabled": true,
  "java.import.gradle.wrapper.enabled": true,
  "java.import.maven.enabled": true
}
EOF
  marker_sh .vscode/lo-server.sh lo-hostile-vscode "a program an editor's settings name"

  # Cargo's config, which `cargo metadata` reads: every key that chooses a program or a flag of
  # rustc's, or reaches the network. Lo's environment answers each of these (`build.rustc*` by
  # RUSTC and the empty wrappers, `rustflags` by an empty CARGO_ENCODED_RUSTFLAGS, the rest by
  # CARGO_NET_OFFLINE), so this file alone doesn't refuse the checkout.
  put rust/.cargo/config.toml <<'EOF'
[build]
rustc = "./lo-rustc.sh"
rustc-wrapper = "./lo-rustc-wrapper.sh"
rustc-workspace-wrapper = "./lo-rustc-workspace-wrapper.sh"
rustflags = ["--cfg", "lo_hostile_rustflags"]

[target.aarch64-apple-darwin]
runner = "./lo-runner.sh"
linker = "./lo-linker.sh"
rustflags = ["--cfg", "lo_hostile_rustflags"]
[target.x86_64-unknown-linux-gnu]
runner = "./lo-runner.sh"
linker = "./lo-linker.sh"
rustflags = ["--cfg", "lo_hostile_rustflags"]

[source.crates-io]
replace-with = "lo-hostile"
[source.lo-hostile]
registry = "sparse+https://cargo-src.lo-hostile.invalid/index/"

[registries.lo-hostile]
index = "sparse+https://cargo-reg.lo-hostile.invalid/index/"
credential-provider = "./lo-cred.sh"

[registry]
global-credential-providers = ["./lo-cred.sh"]

[net]
offline = false
EOF
  marker_sh rust/lo-rustc.sh lo-hostile-rustc "a compiler a crate's config names as rustc"
  marker_sh rust/lo-rustc-wrapper.sh lo-hostile-rustc-wrapper "a wrapper around the Rust compiler"
  marker_sh rust/lo-rustc-workspace-wrapper.sh lo-hostile-rustc-workspace-wrapper \
    "a workspace wrapper around the Rust compiler"
  marker_sh rust/lo-runner.sh lo-hostile-runner "a runner a crate's config names for a target"
  marker_sh rust/lo-linker.sh lo-hostile-linker "a linker a crate's config names for a target"
  marker_sh rust/lo-cred.sh lo-hostile-cred "a credential provider a crate's config names"

  # The keys Lo's variables can't answer, in a config of their own above rust/, which cargo reads
  # too, so `checkoutProblem` refuses the checkout for them: cargo sets `[env]` on the rustc it runs
  # for `cargo metadata`, so the dynamic linker would load code into it; rust-analyzer runs cargo
  # with RUSTC_BOOTSTRAP=1, so `[unstable]` takes effect; and `include` reads another config.
  put .cargo/config.toml <<'EOF'
include = ["lo-include.toml"]

[unstable]
config-include = true

[env]
DYLD_INSERT_LIBRARIES = { value = "lo-env.dylib", force = true }
LD_PRELOAD = { value = "lo-env.so", force = true }
EOF

  # rust-analyzer's settings for the workspace, which win over Lo's client settings for workspace-
  # scoped keys and so can run a program, whatever Lo sends. `checkoutProblem` refuses a checkout
  # that has a rust-analyzer.toml.
  put rust/rust-analyzer.toml <<'EOF'
[cargo]
extraEnv = { DYLD_INSERT_LIBRARIES = "lo-env.dylib" }

[cargo.buildScripts]
enable = true
overrideCommand = ["./lo-rust-analyzer.sh"]

[check]
overrideCommand = ["./lo-rust-analyzer.sh"]

[procMacro]
enable = true
server = "./lo-rust-analyzer.sh"
EOF
  marker_sh rust/lo-rust-analyzer.sh lo-hostile-rust-analyzer "a program rust-analyzer's settings name"

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

  # Java's project, as each tool that imports one reads it, beside the code fixture's sources in
  # java/src: Gradle's wrapper, its settings script, which runs a program, its build script and
  # properties, and a JDK in the checkout; Maven's build, its extensions and the options its
  # launcher passes; and Eclipse's project, with a builder that runs a program, an output folder,
  # annotation processing and its settings.
  put java/gradle/wrapper/gradle-wrapper.properties <<'EOF'
distributionBase=GRADLE_USER_HOME
distributionPath=wrapper/dists
distributionUrl=https\://gradle.lo-hostile.invalid/distributions/gradle-99.0-bin.zip
zipStoreBase=GRADLE_USER_HOME
zipStorePath=wrapper/dists
EOF
  marker_sh java/gradlew lo-hostile-gradlew "Gradle's wrapper script"
  put java/settings.gradle <<'EOF'
pluginManagement {
    repositories {
        maven { url = 'https://gradle-plugins.lo-hostile.invalid/repository' }
    }
}

// Fixture: the settings script, which Gradle runs first, running a program beside it.
[new File(settingsDir, 'lo-gradle-settings.sh').path].execute().waitFor()

rootProject.name = 'sample'
EOF
  marker_sh java/lo-gradle-settings.sh lo-hostile-gradle-settings "a program Gradle's settings script runs"
  put java/build.gradle <<'EOF'
plugins {
    id 'java'
    id 'lo.hostile.plugin' version '1.0.0'
}

repositories {
    maven { url = 'https://gradle.lo-hostile.invalid/repository' }
}

dependencies {
    annotationProcessor 'lo.hostile:processor:1.0.0'
}
EOF
  put java/gradle.properties <<'EOF'
org.gradle.java.home=jdk
org.gradle.java.installations.auto-download=true
org.gradle.java.installations.paths=jdk
EOF
  marker_sh java/jdk/bin/java lo-hostile-gradle-java "the java of a JDK in the checkout"
  put java/pom.xml <<'EOF'
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <groupId>lo.hostile</groupId>
  <artifactId>sample</artifactId>
  <version>1.0.0</version>
  <repositories>
    <repository>
      <id>lo-hostile</id>
      <url>https://maven.lo-hostile.invalid/repository</url>
    </repository>
  </repositories>
  <pluginRepositories>
    <pluginRepository>
      <id>hostile-plugins</id>
      <url>https://maven-plugins.lo-hostile.invalid/repository</url>
    </pluginRepository>
  </pluginRepositories>
  <build>
    <extensions>
      <extension>
        <groupId>lo.hostile</groupId>
        <artifactId>extension</artifactId>
        <version>1.0.0</version>
      </extension>
    </extensions>
    <plugins>
      <plugin>
        <groupId>lo.hostile</groupId>
        <artifactId>plugin</artifactId>
        <version>1.0.0</version>
        <executions>
          <execution>
            <phase>generate-sources</phase>
            <goals><goal>generate</goal></goals>
          </execution>
        </executions>
      </plugin>
    </plugins>
  </build>
</project>
EOF
  put java/.mvn/extensions.xml <<'EOF'
<extensions>
  <extension>
    <groupId>lo.hostile</groupId>
    <artifactId>core-extension</artifactId>
    <version>1.0.0</version>
  </extension>
</extensions>
EOF
  put java/.mvn/maven.config <<'EOF'
-Dmaven.repo.local=lo-hostile-maven-repository
EOF
  put java/.mvn/jvm.config <<'EOF'
-XX:+UnlockDiagnosticVMOptions -XX:+LogVMOutput -XX:LogFile=lo-hostile-maven-jvm
EOF
  put java/.project <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<projectDescription>
  <name>sample</name>
  <buildSpec>
    <buildCommand>
      <name>org.eclipse.ui.externaltools.ExternalToolBuilder</name>
      <triggers>full,incremental,</triggers>
      <arguments>
        <dictionary>
          <key>LaunchConfigHandle</key>
          <value>&lt;project&gt;/.externalToolBuilders/lo.launch</value>
        </dictionary>
      </arguments>
    </buildCommand>
    <buildCommand>
      <name>org.eclipse.m2e.core.maven2Builder</name>
    </buildCommand>
    <buildCommand>
      <name>org.eclipse.jdt.core.javabuilder</name>
    </buildCommand>
  </buildSpec>
  <natures>
    <nature>org.eclipse.jdt.core.javanature</nature>
    <nature>org.eclipse.m2e.core.maven2Nature</nature>
  </natures>
</projectDescription>
EOF
  put java/.externalToolBuilders/lo.launch <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<launchConfiguration type="org.eclipse.ui.externaltools.ProgramBuilderLaunchConfigurationType">
  <stringAttribute key="org.eclipse.ui.externaltools.ATTR_LOCATION" value="${project_loc}/lo-eclipse-builder.sh"/>
  <stringAttribute key="org.eclipse.ui.externaltools.ATTR_RUN_BUILD_KINDS" value="full,incremental,auto,"/>
</launchConfiguration>
EOF
  marker_sh java/lo-eclipse-builder.sh lo-hostile-eclipse-builder "a program Eclipse's project builds with"
  put java/.classpath <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<classpath>
  <classpathentry kind="src" path="src/main/java"/>
  <classpathentry kind="src" path="lo-hostile-apt-generated">
    <attributes>
      <attribute name="optional" value="true"/>
    </attributes>
  </classpathentry>
  <classpathentry kind="con" path="org.eclipse.jdt.launching.JRE_CONTAINER">
    <attributes>
      <attribute name="javadoc_location" value="https://javadoc.lo-hostile.invalid/api/"/>
    </attributes>
  </classpathentry>
  <classpathentry kind="con" path="org.eclipse.m2e.MAVEN2_CLASSPATH_CONTAINER"/>
  <classpathentry kind="output" path="lo-hostile-eclipse-output"/>
</classpath>
EOF
  put java/.factorypath <<'EOF'
<factorypath>
  <factorypathentry kind="WKSPJAR" id="/sample/lib/lo-processor.jar" enabled="true" runInBatchMode="false"/>
</factorypath>
EOF
  put java/.settings/org.eclipse.jdt.apt.core.prefs <<'EOF'
eclipse.preferences.version=1
org.eclipse.jdt.apt.aptEnabled=true
org.eclipse.jdt.apt.genSrcDir=lo-hostile-apt-generated
org.eclipse.jdt.apt.reconcileEnabled=true
EOF
  put java/.settings/org.eclipse.jdt.core.prefs <<'EOF'
eclipse.preferences.version=1
org.eclipse.jdt.core.compiler.processAnnotations=enabled
EOF

  # The JVM's own options in the folder it runs in, which a JVM reads only when told to.
  put .hotspotrc <<'EOF'
+UnlockDiagnosticVMOptions
+LogVMOutput
LogFile=lo-hostile-hotspotrc
EOF

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

  # PHP's tools, where Composer installs them: those a server runs to check, fix, format or test
  # a file, from the folder it runs in, the checkout's root.
  for tool in phpcs phpcbf phpstan phpmd mago pint php-cs-fixer phpunit; do
    marker_sh "vendor/bin/$tool" "lo-hostile-$tool" "a PHP tool Composer installs, $tool"
  done

  # A package's class, committed where Composer installs it, which php-lsp indexes only with
  # indexVendor on.
  put vendor/acme/planted/src/Planted.php <<'EOF'
<?php

namespace Acme\Planted;

/** Fixture: a class of a package in vendor/, read as text. */
final class Planted
{
}
EOF

  # php-lsp's settings for the repository, at its root: two of those tools to run on a save, a
  # folder in the checkout for its cache, an older PHP to read code as, and vendor/ indexed.
  put .php-lsp.json <<'EOF'
{
  "externalTools": {
    "phpstan": { "enabled": true, "binPath": "vendor/bin/phpstan" },
    "phpcs": { "enabled": true, "binPath": "vendor/bin/phpcs" }
  },
  "cachePath": "lo-hostile-php-lsp-cache",
  "phpVersion": "7.4",
  "indexVendor": true
}
EOF

  # mise: its config sources a script, which mise runs only in a configuration it trusts.
  put mise.toml <<'EOF'
[tools]
node = "99.0.0"
python = "99.0.0"

[env]
_.source = "./lo-mise-env.sh"
EOF
  marker_bash lo-mise-env.sh lo-hostile-mise "a script mise's configuration sources"

  # Go's generators, which `go generate` runs, and cgo, which runs `pkg-config` and a C compiler.
  put go/generate.go <<'EOF'
package main

//go:generate ./lo-go-generate.sh
EOF
  marker_sh go/lo-go-generate.sh lo-hostile-go-generate "a program a //go:generate line names"
  put go/cgo.go <<'EOF'
package main

// #cgo pkg-config: lo-hostile
// #cgo CFLAGS: -DLO_HOSTILE
import "C"
EOF

  # Programs a tool would find on PATH, in a folder direnv's .envrc adds to it.
  put .envrc <<'EOF'
PATH_add hostile/bin
EOF
  marker_sh hostile/bin/terraform lo-hostile-terraform "a Terraform a language server finds on PATH"
  marker_sh hostile/bin/gopackagesdriver lo-hostile-gopackagesdriver \
    "a driver Go's package loader finds on PATH"

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
  put .sdkmanrc <<'EOF'
java=99.0.0-tem
EOF
  put .java-version <<'EOF'
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
  # A workspace of the Go project alone, which names no folder outside the checkout.
  put go.work <<'EOF'
go 1.24

toolchain go1.99.9

use ./go
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

  # A repository whose HEAD names a commit it doesn't have, and whose one remote is a promisor, so
  # git fetches the commit from it, which is a host that doesn't exist.
  plant_repository git/lazy
  put git/lazy/refs/heads/main <<'EOF'
0123456789abcdef0123456789abcdef01234567
EOF
  put git/lazy/config <<'EOF'
[core]
	repositoryformatversion = 1
	bare = false
	worktree = .
[extensions]
	partialClone = origin
[remote "origin"]
	url = https://lazy.lo-hostile.invalid/lo/lazy.git
	promisor = true
	partialclonefilter = blob:none
EOF

  # A submodule on a host that doesn't exist: its entry, which `build_hostile` stages below.
  put .gitmodules <<'EOF'
[submodule "hostile"]
	path = hostile/submodule
	url = https://submodule.lo-hostile.invalid/lo/submodule.git
EOF

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

  # An MSBuild SDK, which global.json pins and NuGet would download.
  put hostile/dotnet-sdk/global.json <<'EOF'
{
  "msbuild-sdks": {
    "Lo.Hostile.Sdk": "1.0.0"
  }
}
EOF
  put hostile/dotnet-sdk/NuGet.config <<'EOF'
<configuration>
  <packageSources>
    <clear />
    <add key="lo-hostile" value="https://nuget-sdk.lo-hostile.invalid/v3/index.json" />
  </packageSources>
</configuration>
EOF
  put hostile/dotnet-sdk/Hostile.csproj <<'EOF'
<Project Sdk="Lo.Hostile.Sdk">

  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
  </PropertyGroup>

</Project>
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

# A module from the Terraform Registry, whose inputs and outputs terraform-ls asks it for.
module "registry" {
  source  = "lo-hostile/module/invalid"
  version = "1.0.0"
}
EOF

  plant_terraform_provider

  # A package whose manifest writes a marker as SwiftPM evaluates it, and settings for the package
  # that evaluate it outside SwiftPM's sandbox, which would keep it from writing beside itself.
  put hostile/swift/Package.swift <<'EOF'
// swift-tools-version: 5.9
import Foundation
import PackageDescription

// Fixture: a Swift package's manifest, which SwiftPM runs to read. Writes the empty file lo-hostile-swift-manifest beside itself, and nothing else.
_ = FileManager.default.createFile(atPath: URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("lo-hostile-swift-manifest").path, contents: nil)

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
  put hostile/swift/.sourcekit-lsp/config.json <<'EOF'
{
  "swiftPM": { "disableSandbox": true }
}
EOF

  # --- Swift's build files ---------------------------------------------------------------------

  # A build server, which SourceKit-LSP starts as the program its configuration names, relative to
  # the workspace's root: by `.bsp/`, where the build server protocol looks, and by the
  # `buildServer.json` SourceKit-LSP also reads there.
  for config in .bsp/lo-hostile.json buildServer.json; do
    put "$config" <<'EOF'
{
  "name": "lo-hostile",
  "version": "1.0.0",
  "bspVersion": "2.2.0",
  "languages": ["swift", "c"],
  "argv": ["hostile/swift-bsp/lo-bsp.sh"]
}
EOF
  done
  marker_sh hostile/swift-bsp/lo-bsp.sh lo-hostile-bsp "a build server SourceKit-LSP starts"

  # SourceKit-LSP's settings for the workspace, which win over its client's: generated files kept
  # in the checkout, compile commands taken from hostile/swift-commands, and a package built, as
  # background indexing prepares it, outside SwiftPM's sandbox.
  put .sourcekit-lsp/config.json <<'EOF'
{
  "generatedFilesPath": "lo-hostile-sourcekit-lsp",
  "defaultWorkspaceType": "compilationDatabase",
  "compilationDatabase": { "searchPaths": ["hostile/swift-commands"] },
  "backgroundIndexing": true,
  "backgroundPreparationMode": "build",
  "swiftPM": { "disableSandbox": true }
}
EOF

  # Compile commands: a Swift macro whose plugin is a program of the checkout's, which the
  # compiler runs to expand it, and a plugin the C compiler would load as a library.
  put hostile/swift-commands/compile_commands.json <<'EOF'
[
  {
    "directory": ".",
    "file": "Lo.swift",
    "arguments": [
      "swiftc",
      "-module-name",
      "LoHostile",
      "-load-plugin-executable",
      "lo-swift-macro.sh#LoHostileMacros",
      "Lo.swift"
    ]
  },
  {
    "directory": ".",
    "file": "lo.c",
    "arguments": [
      "clang",
      "-Xclang",
      "-load",
      "-Xclang",
      "lo-clang-plugin.dylib",
      "-fplugin=lo-clang-plugin.dylib",
      "-c",
      "lo.c"
    ]
  }
]
EOF
  put hostile/swift-commands/Lo.swift <<'EOF'
/// A macro whose plugin compile_commands.json names, which the compiler runs to expand it.
@freestanding(expression) macro lo() -> Int = #externalMacro(module: "LoHostileMacros", type: "Lo")

let planted = #lo()
EOF
  put hostile/swift-commands/lo.c <<'EOF'
int lo(void) { return 0; }
EOF
  marker_sh hostile/swift-commands/lo-swift-macro.sh lo-hostile-swift-macro \
    "a macro's plugin that compile commands name"

  # A package with a build tool plugin, which SwiftPM builds and runs as it builds the package, and
  # which runs lo-swift-plugin.sh first; and settings for the package that build it outside
  # SwiftPM's sandbox, which would keep the manifest and the plugin from writing beside themselves.
  put hostile/swift-plugin/Package.swift <<'EOF'
// swift-tools-version: 5.9
import Foundation
import PackageDescription

// Fixture: a Swift package's manifest, which SwiftPM runs to read. Writes the empty file lo-hostile-swift-plugin-manifest beside itself, and nothing else.
_ = FileManager.default.createFile(atPath: URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("lo-hostile-swift-plugin-manifest").path, contents: nil)

let package = Package(
    name: "LoHostilePlugin",
    targets: [
        .executableTarget(name: "LoHostile", path: "Sources", plugins: ["LoHostilePlugin"]),
        .plugin(name: "LoHostilePlugin", capability: .buildTool(), path: "Plugins")
    ]
)
EOF
  put hostile/swift-plugin/Plugins/plugin.swift <<'EOF'
import Foundation
import PackagePlugin

/// A build tool plugin, which runs lo-swift-plugin.sh before each build of the package.
@main
struct LoHostilePlugin: BuildToolPlugin {
    func createBuildCommands(context: PluginContext, target: Target) throws -> [Command] {
        // Fixture: a Swift package's build tool plugin. Writes the empty file lo-hostile-swift-build-plugin beside itself, and nothing else.
        _ = FileManager.default.createFile(atPath: URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("lo-hostile-swift-build-plugin").path, contents: nil)
        return [
            .prebuildCommand(
                displayName: "lo-hostile",
                executable: context.package.directory.appending("lo-swift-plugin.sh"),
                arguments: [],
                outputFilesDirectory: context.pluginWorkDirectory
            )
        ]
    }
}
EOF
  put hostile/swift-plugin/Sources/main.swift <<'EOF'
print("hostile")
EOF
  put hostile/swift-plugin/.sourcekit-lsp/config.json <<'EOF'
{
  "backgroundIndexing": true,
  "backgroundPreparationMode": "build",
  "swiftPM": { "disableSandbox": true }
}
EOF
  marker_sh hostile/swift-plugin/lo-swift-plugin.sh lo-hostile-swift-plugin \
    "a program a package's build tool plugin runs"

  # The submodule's entry is a commit that isn't anywhere, which `git add` would only drop.
  g add -A
  g update-index --add --cacheinfo 160000,0123456789abcdef0123456789abcdef01234567,hostile/submodule
  commit_staged 'Plant what a language server must ignore' 2026-11-15T09:20:00Z
}

# Pushes the branches, and opens the pull request. Sets `hostile_pull`.
publish_hostile() {
  reopen_pull code/hostile code/base
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
