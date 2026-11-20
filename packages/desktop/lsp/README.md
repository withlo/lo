# lsp

Language servers, for main: `startServer` starts one, speaks the protocol with it over stdio on
`vscode-jsonrpc`, and stops it with everything it started. The package also downloads the servers
and the toolchains they use. `AGENTS.md`, under "Language servers", has the rules; this is what the
package holds a server to.

## Limits

| What                                | Limit                                      |
| ----------------------------------- | ------------------------------------------ |
| A message                           | 64 MB                                      |
| A message's header                  | 8 KB, with one `Content-Length`            |
| Output read but not yet handled     | 80 MB                                      |
| Messages, answers and notifications | 50,000 in any 10 s                         |
| Output, stderr included             | 256 MB in any 10 s                         |
| Lines of stderr                     | 50,000 in any 10 s                         |
| Its family's resident memory        | 4 GB unless its spec says, read every 5 s  |
| Requests                            | 8 at the server, 64 waiting, 32 unanswered |
| Open files                          | 50                                         |
| A stop                              | 4.75 s                                     |

A server past any of the first seven is killed at once, whatever its state, a stop's included. One
whose memory can't be read three times running is stopped, since its cap would go unenforced.

No real server comes near the rates: a large workspace's diagnostics are thousands of messages over
many seconds, the largest answers a few megabytes, and a server logs far fewer lines. Bytes alone
don't bound stderr: a flood of empty lines is a line a byte. Below the rates, a flood still can't
keep main from its turns. The connection handles one message a turn, so Lo hands it one a turn, and
reads more of the server's output only while fewer than 512 messages, or 1 MB of them, wait. The
rest waits in the pipe. Lo reads stderr a piece a turn, and the log, which keeps 1,000 lines, splits
and cleans only the last 1,000 lines of a piece, or of a message it logs, and only counts the rest.
Once `shutdown` is answered, or given up on, nothing more is read at all, so however much a server
sends, a stop keeps its time.

A stop's last read of the family and a kill's rounds freeze the server's group, for at most 250 ms
and 400 ms. If Lo itself is killed or crashes then, the group stays stopped for good: it was started
with `setsid`, so the system never sends it `SIGCONT`. Lo's quitting waits for each stop, so only Lo
dying in that moment leaves one.

## A server's family

A server leads a process group of its own. Its family is that group and every process descended from
a member of it, found by parent ID, so a process that left the group by starting a session of its
own (`setsid`) is still found.

- A stop reads the family while the server shuts down, within that wait. Once `exit` has had its
  second, it freezes the group with `SIGSTOP`, reads the family again, sends `SIGTERM` to all of it,
  and lets the group go on with `SIGCONT` to the `SIGTERM` waiting for it. Frozen, nothing in the
  group can leave it, or start a process outside it, between that read and the signal. 2 s later it
  kills what's left, as below. A kill that begins during a stop, as when the server's memory passes
  its cap, takes the stop over: from then on only the kill signals the family, so the group it froze
  is never let go on, and the stop waits for it. At most 4.75 s in all: 1 s, 1 s, the read's 250 ms,
  2 s, the freeze's 400 ms and 100 ms for the kill to land.
- A kill freezes the group with `SIGSTOP`, then reads the family and freezes what it finds outside
  the group, round after round until a round finds nothing new, at most 8 rounds within 400 ms. Only
  then does it send `SIGKILL` to everything frozen. A frozen process can't start another, so a round
  that finds nothing new has found the whole family.
- A process read earlier is signalled only while it's the same process: the same ID, started at the
  same time. An ID that has since been taken by another process is left alone.
- A service the system starts for a server is `launchd`'s child, not the server's, as
  `SourceKitService` is for SourceKit-LSP's `sourcekitd`. A server's spec names the services it
  starts (`services`), and each read of the family takes in each process by one of those names that
  has the server's home as its `HOME`, and what descends from it. A home is the folder of one
  repository and one adapter, not of one server, so a service an earlier server there left is taken
  in too, as Lo's own; no other repository's or adapter's server names it. On Linux the read matches
  that exact entry in `/proc/<pid>/environ`. On macOS `ps -E` lists a process's program, arguments
  and environment as one line, with nothing to tell its entries apart, so the read lists the same
  processes without `-E` as well and looks only in what follows their program and arguments: for
  `HOME=<home>` at its start or after a space, followed by another variable's ` NAME=` or the end.
  No argument can match, but another variable whose value holds ` HOME=<home>` followed by its end
  or what looks like a variable still could, and so could a `HOME` whose value is the home followed
  by what looks like another variable. Only processes named like a service are searched, so a false
  match is unlikely, and it can only take in a process named like one of Lo's own services. So the
  service's memory counts against the cap, and a stop or a kill signals it with the rest.

### What can't be found

- A process whose parent exits before Lo reads it, such as a daemon that forks twice, is taken in by
  the system's first process, or a subreaper, and nothing ties it to the server any longer. It
  outlives the stop.
- Once a server has exited on its own, by crashing, what it left behind is found only if a stop read
  it first.
- What has left the group isn't frozen for the read before `SIGTERM`, so a process one of those
  starts during that read misses `SIGTERM`. A kill finds it by its parent while that's alive; once
  its parent has ended at `SIGTERM`, it's the first case above.
- A family still finding new processes after 8 rounds or 400 ms: what's frozen is killed, and a
  process started in the last round isn't. Only processes not yet frozen can start one, and each
  round freezes all it finds, so this takes a process that starts others faster than Lo can read.
- A read of the family has 250 ms. If it takes longer, or fails, only the group, and what was found
  before that's still the same process, is signalled. Beside each read, what was found before is
  read again by its ID alone, and an ID that can't be told in that time to be the same process is
  left alone.

## Servers

The servers Lo runs, each with its adapter in `src/adapters/`. All but one are downloaded on first
use for a trusted view, as `servers.json` pins them. The exception is SourceKit-LSP, Swift's: on
macOS it's Apple's, which comes with Xcode and with Apple's Command Line Tools, and Lo runs the copy
there (`src/adapters/sourcekit.ts`); on Linux it comes in the Swift toolchain Lo downloads for the
distribution (`src/swift.ts`), which needs some of the distribution's packages installed. So no
other server needs anything installed: what one needs is Lo's own copy, downloaded with it. The last
column says what a server can't do, and a checkout one won't run on is under "Checkouts a server
refuses".

| Server         | Version    | For                    | From                                                                                        | License                                                       | Needs                               | Can't do                                                                                                                                                                                  |
| -------------- | ---------- | ---------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| vtsls          | 0.3.0      | TypeScript, JavaScript | npm: `@vtsls/language-server` and its 17 dependencies, TypeScript 5.9.3 among them          | MIT; TypeScript's is Apache-2.0, the rest MIT or ISC          | Node                                | Run a workspace's TypeScript or load a `tsserver` plugin from the checkout. It fetches no types, so a dependency's symbols show their import only.                                        |
| Pyright        | 1.1.414    | Python                 | npm: `pyright`                                                                              | MIT                                                           | Node                                | Run an interpreter, so it reads packages only from a virtual environment the checkout's config names. It gives no type hints.                                                             |
| rust-analyzer  | 2026-11-09 | Rust                   | GitHub releases: `rust-lang/rust-analyzer`                                                  | MIT OR Apache-2.0                                             | Rust                                | Run build scripts or proc macros, or fetch crates: generated code, macro expansions and dependencies it can't resolve offline are missing. Refuses some checkouts.                        |
| php-lsp        | 0.33.0     | PHP                    | GitHub: the releases of [jorgsowa/php-lsp](https://github.com/jorgsowa/php-lsp)             | MIT                                                           | None                                | Run PHP, so code is read as PHP 8.5, and a function PHP 8 removed has no hover. `gr` never looks in `vendor/`.                                                                            |
| gopls          | 0.24.0     | Go                     | proxy.golang.org: `golang.org/x/tools/gopls` and the 23 modules it builds with, built by Lo | BSD-3-Clause; the rest BSD-3-Clause, MIT, MIT-0 or Apache-2.0 | Go                                  | Fetch modules, run cgo or `go generate`: a dependency not in the checkout shows its import only, and a file that imports `"C"` is left out. Refuses some checkouts.                       |
| terraform-ls   | 0.39.1     | Terraform              | releases.hashicorp.com                                                                      | MPL-2.0                                                       | None                                | Run Terraform or a provider: its schemas are the ones it carries, not the versions a lock file pins, and other providers have none. It gives no type hints.                               |
| Eclipse JDT LS | 1.63.0     | Java                   | download.eclipse.org: its release's archive                                                 | EPL-2.0                                                       | Temurin JDK                         | Import a Gradle or Maven build, so what a build brings has no definition. A source folder past the nearest 20,000 folders and 20,000 files gets fewer answers. Refuses some checkouts.    |
| Roslyn         | 5.11.0     | C#                     | nuget.org: `roslyn-language-server.<platform>`, signed by Microsoft                         | MIT                                                           | .NET SDK                            | Load the checkout's projects: a package's types and what a source generator writes have no definition, and every `.cs` file is one project at the SDK's defaults. Refuses some checkouts. |
| SourceKit-LSP  | Apple's    | Swift, on macOS        | Xcode or Apple's Command Line Tools, in the developer folder `xcode-select -p` names        | Apache-2.0                                                    | Xcode or Apple's Command Line Tools | Read a build: each file is read alone with the macOS SDK, so a use of what another file declares isn't resolved, and `gr` comes from the syntax index. Refuses some checkouts.            |
| SourceKit-LSP  | 6.4.2      | Swift, on Linux        | download.swift.org: in the Swift toolchain for the distribution                             | Apache-2.0                                                    | Swift, and the packages it lists    | Read a build: each file is read alone with the system's headers, so a use of what another file declares isn't resolved, and `gr` comes from the syntax index. Refuses some checkouts.     |

What a server needs is pinned and downloaded the same way, but for Apple's. Node is in
`servers.json`, beside the servers. The toolchains, which Settings lists and removes, are in
`toolchains.json`; on macOS Settings lists Apple's Swift too, with nothing to remove.

| Needs       | Version  | From                          | License                              | For                     |
| ----------- | -------- | ----------------------------- | ------------------------------------ | ----------------------- |
| Node        | 26.13.1  | nodejs.org                    | MIT                                  | vtsls and Pyright       |
| Rust        | 1.100.0  | static.rust-lang.org          | MIT OR Apache-2.0                    | rust-analyzer           |
| Go          | 1.27.4   | dl.google.com                 | BSD-3-Clause                         | gopls                   |
| Temurin JDK | 25.0.5+8 | Adoptium's releases on GitHub | GPL-2.0 with the Classpath Exception | JDT LS                  |
| .NET SDK    | 10.0.404 | builds.dotnet.microsoft.com   | MIT                                  | Roslyn                  |
| Swift       | 6.4.2    | download.swift.org            | Apache-2.0                           | SourceKit-LSP, on Linux |

Swift is pinned once for each Linux distribution swift.org builds it for and gives install
instructions for, since each build links its distribution's libraries: Ubuntu 22.04, 24.04 and
26.04, Debian 12 and 13, Fedora 41 and Red Hat Enterprise Linux 9, each for x64 and arm64, all
installed with deb or rpm packages, as Lo is. `/etc/os-release` says which a system takes
(`swiftDistroFor`): its own release, or for a distribution built on one of them, the one it names
(`UBUNTU_CODENAME`, `DEBIAN_CODENAME`, or `rhel` in `ID_LIKE` and the major version), and for
Fedora, Fedora 41's build for it and every release after, since swift.org builds for no later
Fedora. Of the system's libraries, SourceKit-LSP and what it loads link only glibc's, GCC's runtime,
libstdc++, libcurl, libxml2, SQLite, ncurses, libuuid and zlib, and later Fedoras keep each under
the name it links; Fedora 45 keeps libxml2's in `libxml2_2.13`, which it needs besides. A
distribution built on Fedora doesn't say which Fedora, so it takes none. Settings lists only the one
a system takes. A Linux none fits, such as Arch or Ubuntu 25.10, has no Swift server, and Swift
answers from the syntax index. Each build needs the packages swift.org's instructions list for its
distribution, which Lo checks before it downloads anything, by dpkg's list or by asking rpm
(`missingPackages`): with any missing, Swift's server says which, and the `apt-get` or `dnf` command
that installs them. Lo installs nothing on the system. `pnpm nx run lsp:sourcekit`
(`scripts/sourcekit.ts`) tries it for real on a Linux a build fits: it installs that build as Lo
does, starts SourceKit-LSP on the code fixture's checkout, and fails unless a hover on `countWords`
gives its signature, its logs are in its own home and nothing appeared in the user's, in any folder
of it (`scripts/home.ts` lists the home before and after). CI's `swift` job runs it on Ubuntu 24.04
when Swift's pins change, or anything it runs does: the workflow lists them.

vtsls and Pyright each start as Node, by its absolute path, with a cap on its heap, then the
server's own entry point inside its install, never the launcher npm would link. rust-analyzer,
php-lsp, gopls and terraform-ls each start as its program, by its absolute path inside its install.
JDT LS starts as the JDK's `java`, by its absolute path, with `-jar` and Equinox's launcher inside
its install. Roslyn starts as Lo's `dotnet`, by its absolute path, with `exec` and the server's own
assembly inside its install, never the launcher its package's tool would run. SourceKit-LSP starts
as its program, by its absolute path in Xcode or the Command Line Tools on macOS, and in Lo's Swift
toolchain on Linux. None runs through a shell, and each has an environment built from nothing, whose
proxy leads nowhere (`NO_NETWORK` in `src/environment.ts`). What each is told is its adapter's
alone, and the adapter says why each setting is as it is:

- **vtsls** runs its own TypeScript, never a workspace's (`node_modules/typescript`), and has
  automatic type acquisition off, so it runs no npm. It loads no `tsserver` plugin from the
  checkout. A plugin a checkout's `tsconfig.json` names is looked for by its package's name alone,
  in the `node_modules` beside Lo's TypeScript and, as Node finds packages, in each `node_modules`
  above Lo's install, so a checkout can load a package you already have there, though it can't add
  one. Neither vtsls nor `tsserver` can turn those plugins off. On a Mac, Lo's cache is outside your
  home folder, so those never include `~/node_modules`; on Linux it's in `~/.cache`, so they do.
  `tsserver`'s heap is capped at 3 GB and vtsls's at 512 MB, under Lo's 4 GB for the group.
- **Pyright** is given `/dev/null` as its Python, which can't run, so it runs no interpreter: not
  the machine's, nor one a checkout's virtual environment or `.python-version` would pick. It
  carries the standard library's stubs itself. It answers no inlay hints, so its adapter says it has
  none (`hints: false`).
- **rust-analyzer** reads a Cargo project with `cargo metadata`, which runs `cargo` and, through it,
  `rustc`, and asks `cargo rustc --print` for the target's `cfg`s, with `RUSTC_BOOTSTRAP=1` and the
  nightly channel, so unstable options are on. All three are Lo's: `CARGO` and `RUSTC` and the
  toolchain's folder first on the `PATH` point to Lo's copy, and `cargo.sysroot` is Lo's toolchain,
  with the standard library's sources (`rust-src`) beside it. `RUSTC_WRAPPER` and
  `RUSTC_WORKSPACE_WRAPPER` are empty, which undoes a checkout's `.cargo/config.toml`
  `build.rustc-wrapper`; `cargo` reads `RUSTC` before the file's `build.rustc` too. An empty
  `CARGO_ENCODED_RUSTFLAGS` beats `RUSTFLAGS` and a config's `build.rustflags` and
  `target.*.rustflags`, some of which would load code into Lo's `rustc` with unstable options on,
  and an empty `CARGO_ENCODED_RUSTDOCFLAGS` does the same for `rustdoc`'s; rust-analyzer passes its
  environment to every `cargo` and `rustc` it runs. With no rustup and the sysroot set, nothing
  reads a `rust-toolchain.toml`. `CARGO_NET_OFFLINE=true`, and `CARGO_HOME` defaults to a private
  `.cargo` in the server's `HOME`, so `cargo metadata` fetches nothing — no registry, no git
  dependency, no `[source]` replacement, no credential-provider — whatever a checkout's
  `.cargo/config.toml` says. For a crate whose dependencies aren't already in that `CARGO_HOME`,
  `cargo metadata` can't resolve them offline and rust-analyzer loads the workspace without them:
  the workspace's own code is analysed in full, but go-to-definition into a dependency doesn't
  resolve. Lo doesn't fetch crates. Nor does anything write in the checkout: `cargo metadata` writes
  a `Cargo.lock` as it resolves a workspace that has none, beside its `Cargo.toml` or wherever a
  config's `resolver.lockfile-path` names, and rust-analyzer has it write to a copy in its `TMPDIR`
  only for a workspace that has one, so for the rest `CARGO_RESOLVER_LOCKFILE_PATH` names a file in
  the server's home, which beats the config. A lock file steers the resolve that reads it, keeping
  its versions, or failing on a vendored crate whose checksum differs, so that file is the
  checkout's, in a folder named by a hash of its path, and each start removes every such folder
  first: no resolve starts from another pull request's lock file or an earlier start's, and
  rust-analyzer starts again on another checkout rather than moving there (`stays`). The workspaces
  without a lock file in one checkout still share the file, so one's versions can steer another's.
  Build scripts (`build.rs`) and proc-macro crates are a checkout's code, so
  `cargo.buildScripts.enable` and `procMacro.enable` are both off; the cost is that a `build.rs`'s
  generated code and a macro's or derive's expansion aren't seen, and a hover or definition that
  needs them falls back to the syntax index. The commands that would run a checkout's tools
  (`check.overrideCommand`, `checkOnSave`, `cargo.buildScripts.overrideCommand`, the runnables' and
  tests') are at their safe defaults, and Lo never saves, so no check runs. With these off, nothing
  is built and no `target/` is made. rust-analyzer has no heap flag, so Lo's 4 GB cap on the group
  bounds it; its caches aren't primed for files Lo never opens. What Lo's settings and variables
  can't answer refuses the checkout instead.
- **php-lsp** carries the stubs of PHP's own functions and classes, so it needs no PHP. It's told
  which PHP to read code as (`phpVersion`, PHP 8.5), so it never runs a `php` to ask: one can be
  first on its `PATH`, in the folder of Lo's git, as Homebrew's is. Code for an older PHP is read as
  8.5 too, so a function PHP 8 removed, such as `each`, has no hover. It has PHPStan and PHPCS off,
  so it runs no tool. It skips `vendor/` as it indexes, since a committed `vendor/` can hold far
  more code than the project, which would cost memory and time and count against its cap on the
  files it indexes. `gd`, `K` and `gh` still find a class there through Composer's autoload, and
  `gr` never looks there. Its cache is where it keeps one by default, `.cache/php-lsp` in its
  `HOME`, a folder for each version of itself and each checkout, under caps of its own; Lo names no
  `cachePath`, which php-lsp would take as the whole cache, with none of those. A checkout's
  `.php-lsp.json` can't turn the tools on or move the cache, and what Lo says wins over the rest of
  it key by key. Lo asks it for nothing that would run another program, such as formatting or a code
  lens's tests.
- **gopls** runs `go list` and `go env` on the checkout with Lo's Go, held by Go's variables
  (`src/toolchains.ts`): a `toolchain` line fetches no other Go, no module is fetched, nothing adds
  a flag such as `-toolexec` or names a package driver, and cgo is off, so no C compiler or
  `pkg-config` runs. `//go:generate` lines run only under `go generate`, which gopls runs only for a
  command Lo never sends. Vulncheck is off, and its telemetry stays in its home, never uploaded.
  `GOMEMLIMIT` keeps its heap at 3 GB, under the group's cap.
- **terraform-ls** is given `/dev/null` as Terraform, so it never runs `terraform`, the machine's or
  one on `PATH`, nor the provider plugins a checkout's `.terraform/` holds, which
  `terraform providers schema` would. Without it, it reads providers' schemas from the ones it
  carries, the Terraform Registry's official and partner providers as it was built, not the versions
  a checkout's lock file pins, and has none of other providers; definitions, references and the
  outline come from the configuration and are whole, though it answers references only at a
  declaration, so `gr` finding none where the reader is asks it for the definition, then for the
  references there. It asks registry.terraform.io about each module a configuration calls from the
  Registry, which no setting turns off, and the dead proxy fails each request before anything is
  sent. It answers no inlay hints (`hints: false`).
- **JDT LS** is given Lo's Temurin JDK alone (`JAVA_HOME`), and reads its classes and sources as the
  project's library. It imports nothing: Gradle's and Maven's imports are off, and every folder is
  left out of its search for build files, so it reads no `build.gradle`, `pom.xml` or Eclipse
  `.project`, and no build script, wrapper, plugin or annotation processor runs. Lo finds the
  checkout's source folders itself, from each `.java` file's package, in the 20,000 folders and
  20,000 files nearest the root, and JDT LS makes a project of them in its home, compiling nothing;
  a file in a source folder past those is outside its project, and gets fewer answers. All it writes
  is in its home: its workspace, Equinox's configuration, the JVM's home and its temporary files,
  named by system properties, since a JVM takes its home from the system, not `HOME`, and Gradle's
  home, by `GRADLE_USER_HOME`. It reaches no host: its JVM looks names up only in an empty hosts
  file of Lo's, and uses no proxy, which would look names up itself. A JVM takes none from the
  environment, and JDT LS is told to give Eclipse's networking none of the system's
  (`jdt.ls.disableProxies`, `java.net.useSystemProxies=false`). Two parts of it try to fetch
  whatever its settings say, and no setting stops them trying: Buildship asks services.gradle.org
  for Gradle's versions as it starts, and a hover on a class from a jar in `lib/`, or its source,
  has it ask search.maven.org which artifact the jar is, by its SHA-1, then m2e to download the
  artifact's sources, which Maven's offline setting keeps to the empty repository in its home. Above
  the checkout it reads nothing: when a folder the checkout is in is named `src`, it looks only for
  whether the folder holding that one has a build file, and makes no project if it has. Its heap is
  capped at 2.5 GB, under Lo's 4 GB for the group. It finds its project's folders only as it starts,
  so it restarts on another checkout rather than moving there (`stays`).
- **Roslyn** never loads a project of the checkout's. Loading one is running it: MSBuild runs the
  targets, `Exec` tasks and inline C# tasks a project and the `Directory.Build.props`,
  `Directory.Build.targets` and `Directory.Packages.props` above it bring, a restore fetches what a
  `NuGet.config` names, and the compiler loads the analyzers and source generators packages hold,
  and nothing turns that off for a project of the checkout's. So Lo writes a project of its own in
  the server's home, `project/checkout.csproj`, which lists the checkout's `.cs` files one by one
  (none in `bin`, `obj`, `node_modules` or a hidden folder, no link, and none whose path MSBuild
  would read as another's, with a `\`, or that XML can't hold), compiles them for .NET 10 against
  .NET's and ASP.NET Core's reference assemblies, imports nothing but the SDK's own files, restores
  nothing and drops every analyzer and source generator, the SDK's own too. Roslyn is sent that
  project (`project/open`), told that its folder is the workspace, and run in it, so it neither
  looks through the checkout for projects nor builds a `.cs` file as a program. Its settings turn
  off restores, file-based programs, decompiled and Source Link sources, and code lenses. What's
  lost: a package's types have no definition or hover, nor do the types a source generator would
  write, and every `.cs` file is in one project, read with the SDK's defaults, so the checkout's
  target frameworks, `#if` symbols, references between projects and `LangVersion` don't count, and a
  name two projects both define is defined twice. A checkout with more than 50,000 `.cs` files isn't
  read, and Lo looks in 20,000 of its folders at most, the nearest its root first.
  `DOTNET_GCHeapHardLimit` caps each of its .NET processes' heaps at 3 GB, under Lo's 4 GB. Roslyn
  writes in its home, but for a cache of how its own parts fit together, which it keeps in `cache/`
  beside its program, in its install, with no option to move it: nothing of a checkout's reaches it,
  and the installer, which checks only what it unpacked, ignores it. Roslyn writes it to a file of a
  random name there and moves that to the cache's name, so it appears whole or not at all, though
  unsynced; a move that fails leaves the other file behind.
- **SourceKit-LSP** is the copy in the developer folder the system has chosen, which
  `/usr/bin/xcode-select -p` names when it's run with nothing of Lo's environment: Xcode's
  `Toolchains/XcodeDefault.xctoolchain/usr/bin/sourcekit-lsp`, or the Command Line Tools'
  `usr/bin/sourcekit-lsp`. Never the shim in `/usr/bin`, one on `PATH` or what `xcrun` finds, which
  read `DEVELOPER_DIR` and the like, nor a version manager's shim, which reads a checkout's
  `.swift-version`. It's Apple's, updated with Xcode or the tools, so Lo pins no version of it.
  Given a workspace, it runs what its build files name: a build server from `buildServer.json` or
  `.bsp/`, SwiftPM on a `Package.swift`, which compiles and runs the manifest and its plugins and
  fetches its dependencies, and the flags of a `compile_commands.json`, which can load code into the
  compiler; and it reads `.sourcekit-lsp/config.json`, which can turn those on. No option turns that
  off, so it's told of no workspace (`rootless`: `rootUri` and `workspaceFolders` are `null`) and
  runs in its home: it reads no build files and no workspace settings, and each file Lo opens gets
  fallback build settings, the macOS SDK and Lo's flags. So answers are each file's own and the
  SDK's: `gd`, `K` and `gh` answer within the file and into the SDK, a use of what another file
  declares isn't resolved, and `gr`, which needs a build's index, comes from the syntax index. Its
  generated files and its compiler's module cache are in its home, by its options and by its
  arguments, which hold if it drops its options. Foundation's home folder, where it reads its own
  settings, is in its home too, by `CFFIXED_USER_HOME`. It also reads the machine's settings, in
  `/Library/Application Support/org.swift.sourcekit-lsp/config.json`, which only an administrator
  can write, and no option turns that off; Lo's options win over it, key by key. A request to
  `sourcekitd` gives up after 10.5 s, not 120 s, and one that hangs for 30.5 s, not 300 s, has
  SourceKit-LSP restart `sourcekitd`. Each is given with a fraction: SourceKit-LSP reads a whole
  number in its initialization options as an integer, which those options refuse, and then drops
  every option Lo gives it. Its `SourceKitService` is in its family. Expanding a macro of the SDK's
  runs Apple's `swift-plugin-server`; a checkout's macros are never built. On Linux it's the
  `usr/bin/sourcekit-lsp` of Lo's Swift toolchain, told and kept the same way, but for what Linux
  lacks: there's no SDK, so the compiler reads the system's headers, from the packages Lo checks are
  installed; `sourcekitd` runs in its own process, from the toolchain's `libsourcekitdInProc.so`, so
  there's no service, and `swift-plugin-server` is in its family; and Foundation's home folder, in
  its home by `CFFIXED_USER_HOME` as on macOS, is where it writes its logs too. Foundation on Linux
  takes that folder from the variable, then from the user's entry in the system's list of users, and
  from `HOME` only when there's no entry, so without the variable it would read the user's
  `~/.sourcekit-lsp/config.json`, and write its logs in `~/.sourcekit-lsp/logs`, deleting theirs
  over an hour old. It reads nothing of the machine's, and
  `$XDG_CONFIG_HOME/sourcekit-lsp/config.json` only when that's set, which it isn't.

None runs in a sandbox: each reads what you can, so an absolute import, Pyright's `extraPaths`, a
Rust sysroot's sources, the folders of stubs a `.php-lsp.json` names, the paths a `composer.json`'s
autoload names, or a `composer.json` up to seven folders above the checkout, which php-lsp climbs to
when the checkout has none, a `go.mod`'s `replace` with a path, or a Terraform module's `source`,
lead it to files outside the checkout, and a hover can show what's in one. Roslyn reads the
reference assemblies of Lo's SDK, and a definition in one goes to the signatures it writes in its
home's `TMPDIR`. Each only reads there, and nothing can send what it reads anywhere. Lo never opens
a place outside the checkout an answer names: it shows as outside the repository.

Lo names each server's license wherever it says what the server is: a server's details in the status
bar show its name, version and license, "Pyright 1.1.414 · MIT".

## Checkouts a server refuses

Some files in a checkout steer a server's tools past the variables and settings Lo gives them, so a
server doesn't start on, or move to, a checkout that holds one (`checkoutProblem` in
`src/toolchains.ts`, and an adapter's `checkout`), and says why: each gives the reason alone, and
whoever shows it says first that Lo won't run the server. Each walk of a checkout looks through its
own folders, never through a link to one, which could lead anywhere on the disk.

- **.NET** (Roslyn). A `global.json` can send the SDK's commands, and MSBuild, to an SDK in the
  checkout, whatever the variables say: since .NET 10 its `sdk.paths` names folders to find an SDK
  in, the checkout's own among them. So a server that uses .NET runs only as `dotnet exec`
  (`checkArguments` in `src/process.ts`), which reads none, and only on a checkout with no
  `global.json` in it, nor above it, that names `paths` or spells a key with an escape. Nor does it
  run below a folder that holds a `Directory.Build.props`, `Directory.Build.targets`,
  `Directory.Packages.props` or `NuGet.config`, whatever their case, which MSBuild and NuGet read
  for every project under it (`dotnetAbove`); Roslyn's adapter asks the same of the folders above
  the project Lo writes in its home.
- **Go** (gopls). A `go.work` makes the modules it names one workspace, which Go reads from the
  folder nearest where it runs. So a server that uses Go runs only on a checkout with no `go.work`
  in a folder above it, and none in it that names a folder outside it by `use` or a `replace` with a
  path, or that Lo can't read for certain.
- **Rust** (rust-analyzer). A `rust-analyzer.toml`, whose workspace settings win over Lo's and can
  run a program. A `.cargo/config.toml` (or `.cargo/config`), read as TOML, with an `[env]` table,
  which `cargo` sets on the `rustc` it runs, an `[unstable]` table, which `RUSTC_BOOTSTRAP=1` lets
  take effect, or an `include`, which reads another config, outside the checkout too. So is a Cargo
  config Lo can't read as TOML, one that isn't a plain file or in a `.cargo` that isn't a plain
  folder, and anything named `.cargo/config.toml` or `.cargo/config` in a folder above the checkout,
  a link to a dotfile included. On Linux, Lo's cache is in `~/.cache`, so a `~/.cargo/config.toml`
  of your own is above every checkout, and Lo runs rust-analyzer on none while it's there; on a Mac
  the cache is outside your home folder.
- **Java** (JDT LS). A repository that commits Eclipse's `.settings` folder at its root: JDT LS
  would link its project's settings to it, reading them and writing there.
- **Swift** (SourceKit-LSP). A `buildServer.json`, a `.bsp` or a `.sourcekit-lsp` anywhere in the
  checkout. This SourceKit-LSP reads none of them, since Lo tells it of no workspace, but Apple
  updates it, and a later one that looked for them beside a file it opened would. A `Package.swift`
  and a `compile_commands.json` are common, and no workspace is what keeps them out, so they aren't
  refused.

Each refusal that looks through a checkout matches a file's name at least as loosely as a Mac's
disk, which opens `.ſourcekit-lsp`, with a long s, as `.sourcekit-lsp`, and a name with a Kelvin
sign as one with a `k`: by `foldName`, NFKC and then a full case fold. And each reads at most
100,000 files and folders (`WALK_LIMIT`, as many as Lo unpacks from an archive); a checkout with
more is refused, since what it didn't read could be anything.

## Downloads

`servers.json` pins what Lo downloads, and `scripts/pin.ts` writes it (see `AGENTS.md`).
`toolchains.json` pins the toolchains the same way, with what each unpacks to on each platform;
`src/toolchains.ts` says what a server gets of each. An `Installer` puts each version in
`<folder>/<id>/<version>/`, the servers' in `<cache>/servers/` and the toolchains' in
`<cache>/toolchains/`, holding a download to these:

| What                       | Limit                                                                                    |
| -------------------------- | ---------------------------------------------------------------------------------------- |
| Addresses                  | `https`, the usual port, the entry's hosts by exact name                                 |
| Redirects                  | 5, each held to the same rules, and none followed unseen                                 |
| Room on the disk           | its files and what they unpack to, before it starts                                      |
| A file                     | the size the manifest pins, then its SHA-256                                             |
| Tries                      | 3, when the connection fails, the file comes short or a 5xx                              |
| A stall                    | nothing for 30 s, or under 16 KB in any 5 minutes                                        |
| What an archive unpacks to | 100,000 entries, and what it's recorded to unpack to and 5% more, or 2 GB where it isn't |

Every toolchain records what it unpacks to, so each is held to its own size. Swift's, at about 3.5
GB, is past the 2 GB the rest share even as it's pinned, so `pin.ts` measures it within 6 GB of its
own (`SWIFT_UNPACK_LIMITS`), and Lo holds each install to what it measured and 5% more. | A symbolic
link's target | 1 KB, relative, resolving inside |

A stall counts as a failed connection, and is either of two things, in the time Lo waits for the
network: nothing at all for 30 s, or less than 16 KB in any 5 minutes. The first gives up on a host
that has stopped sending. The second gives up on one that sends a byte now and then, within 5
minutes, while a proxy that holds a file back as it scans it, sending a byte every few seconds
meanwhile (FortiGate sends one every 10 s), has those 5 minutes to finish. 16 KB in 5 minutes is so
slow that no connection that's still working falls below it, and there's no deadline for a whole
download, which can be hundreds of megabytes on a slow connection. `fetch` gives an answer's headers
whole, so each answer, a redirect's included, must begin within 30 s of being asked for, and both
counts start again from it. Lo's own time between waits, such as writing what came, doesn't count.

Nothing is unpacked before its hash matches, and nothing is used before its marker says it's whole.
Absolute paths, `..`, hard links, devices and pipes are refused, and files are written before any
link is made, so nothing is written through one. A download in layers, as Rust's components are,
lays each tarball's component folder over the ones before it, leaving out the rest of the tarball
and the `manifest.in` that lists the component's files; a file a layer before it wrote is refused.

`remove` takes every version of an ID away, as Settings' "Remove" does a toolchain's. From the
moment it's asked, an install of it fails with the removal's reason, and every install under way
stops, those nobody waits for any longer included. What it's given to run first, such as stopping
the servers that use it, runs next, and once that and each install have ended, its folder is renamed
aside and deleted, so nothing finds it half gone and nothing puts it back.

### gopls, built by Lo

The Go team publishes no gopls binary, so Lo builds it (`src/build.ts`). `pin.ts` resolves its
modules with Lo's Go against proxy.golang.org, checked against sum.golang.org as `go` checks them,
and pins the `go.mod` and `go.sum` that require them, each module file the build reads, as any file
is pinned, and the size and SHA-256 of the gopls built for each platform, `-trimpath`,
`CGO_ENABLED=0` and with no version control stamp. On first use, Lo installs its Go, then fetches
those files itself, through its downloader and the entry's hosts (proxy.golang.org, and
storage.googleapis.com, where it redirects), rather than letting `go` fetch them, which would go
around the system's proxy. It lays them out as a module proxy in the download's folder, and builds
once with its Go, offline (`GOPROXY=file://…`, `GOSUMDB=off`, `-mod=readonly` against its `go.sum`,
no `go.work`, and an environment built from nothing). Go's builds are reproducible, so what it
builds is the file pinned, byte for byte: Lo refuses one whose hash is another, and a Go other than
the one gopls was pinned with. A build has 20 minutes, and gopls takes about one. `room` is the most
a build holds on the disk, the module files among them, counted before it starts. Once gopls is
built, the build's folder, about 640 MB of module proxy, module cache, build cache and home, is
removed before the version is put in place, which then holds only the program and its marker.

Each file and folder unpacked is synced to the disk, then the marker, then the folder that holds
them, and only then is it renamed into place. The marker records the fingerprint of the download and
of the rules it was unpacked under (`UNPACK_RULES` in `src/unpack.ts`, raised whenever they change,
or what the marker records does), each file's size, each folder and each link's target. Before an
install is used, each is checked against it, by what the system knows of it, never its bytes. Each
folder below the installer's own, `<id>/` and `<version>/` as well as each the marker records, must
still be a folder, not a link, so nothing below it is reached through one. The installer's own
folder may be a link, as a cache moved elsewhere can be.

### What isn't checked

What a program does once it runs: the hash says it's the file that was pinned, and the signature
`pin.ts` checked then says who published it, not what it does. That's what trust and each server's
environment are for.

Who published php-lsp: its releases are signed by nobody, so `pin.ts` checks each archive against
the checksum its release lists beside it, which the same build made. That catches a download gone
wrong, not a release someone else made. JDT LS's is the same: Eclipse publishes a SHA-256 beside
each archive, on the same host, and signs about half the jars inside it, not the archive or the
launcher's configuration.

Whether Microsoft's certificate was revoked: `pin.ts` takes Roslyn's packages only as nuget.org's
catalog lists them, by their SHA-512, signed as their author's by a certificate whose organization
is Microsoft's, with a timestamp, both chaining to DigiCert's root, pinned by its key, and each good
when the timestamp says the package was signed, and as the package their signature signs. It asks no
one whether a certificate has since been revoked.

An installed file's bytes: before each use, its size is checked, not its hash, which would read
every byte. On macOS, `fsync` leaves what the drive itself caches, and Node can't ask for more
(`F_FULLFSYNC`), so a power loss there can still lose some of an install: a file cut short or gone
is caught by the marker, one of the right size with the wrong bytes isn't.
