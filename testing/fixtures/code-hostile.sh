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
#   Rust's compiler wrapper
#     rust/.cargo/config.toml, `build.rustc-wrapper`, naming rust/lo-rustc-wrapper.sh
#     cargo, checking a crate; marker rust/lo-hostile-rustc-wrapper
#   rust-analyzer's settings
#     rust/rust-analyzer.toml, naming rust/lo-rust-analyzer.sh as the check command and the
#     procedural macro server
#     rust-analyzer, checking a crate or expanding a macro; marker rust/lo-hostile-rust-analyzer
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
#     global.json names an MSBuild SDK, which NuGet would download and MSBuild would run
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

- programs a tool might run: a workspace TypeScript in `node_modules`, a tsserver plugin in `typescript/node_modules`, an npm `postinstall`, `.vscode/settings.json`, a `rustc-wrapper` in `rust/.cargo/config.toml`, the program `rust/rust-analyzer.toml` names, the Gradle and Maven wrappers, Java's Gradle settings script, a JDK in `java/jdk` that `java/gradle.properties` names, an Eclipse builder in `java/.project`, `php/.phpactor.json`'s tools, PHP's tools in `vendor/bin` and the `.php-lsp.json` that turns two of them on, `mise.toml`, and a Terraform provider's plugin committed in `hostile/terraform-provider/.terraform`;
- settings that write in the checkout or turn on what runs: Maven's `.mvn/maven.config` and `.mvn/jvm.config`, Eclipse's `.classpath`, `.factorypath` and `.settings` in `java/`, and a `.hotspotrc`;
- versions that don't exist: `.tool-versions`, `.nvmrc`, `.sdkmanrc`, `.java-version`, `python/.python-version`, `ruby/.ruby-version`, `rust-toolchain.toml`, `go.mod`'s `toolchain`, and a `global.json` that pins an MSBuild SDK;
- git's own settings, in folders of `git/` that look like bare repositories: a `core.fsmonitor` program, hooks, a clean and smudge filter, and a promisor remote that makes git fetch a commit it lacks; and a `.gitmodules` that points a submodule at a host that doesn't exist;
- projects in `hostile/`, and Java's `pom.xml` and Gradle scripts, whose dependencies or registries are on hosts ending `.lo-hostile.invalid`, which never resolve.

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
  "terraform.languageServer.path": "${workspaceFolder}/.vscode/lo-server.sh",
  "java.jdt.ls.java.home": "${workspaceFolder}/java/jdk",
  "java.jdt.ls.vmargs": "-XX:OnError=${workspaceFolder}/.vscode/lo-server.sh",
  "java.configuration.runtimes": [{ "name": "JavaSE-21", "path": "${workspaceFolder}/java/jdk" }],
  "java.import.gradle.enabled": true,
  "java.import.gradle.wrapper.enabled": true,
  "java.import.maven.enabled": true
}
EOF
  marker_sh .vscode/lo-server.sh lo-hostile-vscode "a program an editor's settings name"

  # Cargo's wrapper around rustc, which a crate's config names, relative to the crate.
  put rust/.cargo/config.toml <<'EOF'
[build]
rustc-wrapper = "./lo-rustc-wrapper.sh"
EOF
  marker_sh rust/lo-rustc-wrapper.sh lo-hostile-rustc-wrapper "a wrapper around the Rust compiler"

  # rust-analyzer's settings for a crate, which name programs to run in place of cargo's.
  put rust/rust-analyzer.toml <<'EOF'
[check]
overrideCommand = ["./lo-rust-analyzer.sh"]

[procMacro]
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
EOF

  plant_terraform_provider

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
