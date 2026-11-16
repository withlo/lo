# lsp

Language servers, for main: `startServer` starts one, speaks the protocol with it over stdio on
`vscode-jsonrpc`, and stops it with everything it started. `AGENTS.md`, under "Language servers",
has the rules; this is what the package holds a server to.

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

The servers Lo runs, each downloaded on first use for a trusted view, as `servers.json` pins it, and
each with its adapter in `src/adapters/`. vtsls and Pyright run on Lo's own Node, which downloads
first, php-lsp is a program of its own, and JDT LS runs on Lo's Temurin JDK, a toolchain, which
downloads first. None needs anything installed.

| Server         | Version | For                    | From                                                                               | License                                              |
| -------------- | ------- | ---------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------- |
| vtsls          | 0.3.0   | TypeScript, JavaScript | npm: `@vtsls/language-server` and its 17 dependencies, TypeScript 5.9.3 among them | MIT; TypeScript's is Apache-2.0, the rest MIT or ISC |
| Pyright        | 1.1.414 | Python                 | npm: `pyright`                                                                     | MIT                                                  |
| Node           | 26.13.1 | the two above          | nodejs.org                                                                         | MIT                                                  |
| php-lsp        | 0.33.0  | PHP                    | GitHub: the releases of [jorgsowa/php-lsp](https://github.com/jorgsowa/php-lsp)    | MIT                                                  |
| Eclipse JDT LS | 1.63.0  | Java                   | download.eclipse.org: its release's archive                                        | EPL-2.0                                              |

vtsls and Pyright each start as Node, by its absolute path, with a cap on its heap, then the
server's own entry point inside its install, never the launcher npm would link. php-lsp starts as
its program, by its absolute path inside its install. JDT LS starts as the JDK's `java`, by its
absolute path, with `-jar` and Equinox's launcher inside its install. None runs through a shell, and
each has an environment built from nothing. What each is told is its adapter's alone, and the
adapter says why each setting is as it is:

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
- **JDT LS** is given Lo's Temurin JDK alone (`JAVA_HOME`), and reads its classes and sources as the
  project's library. It imports nothing: Gradle's and Maven's imports are off, and every folder is
  left out of its search for build files, so it reads no `build.gradle`, `pom.xml` or Eclipse
  `.project`, and no build script, wrapper, plugin or annotation processor runs. Lo finds the
  checkout's source folders itself, from each `.java` file's package, and JDT LS makes a project of
  them in its home, compiling nothing. All it writes, its workspace, Equinox's configuration, its
  temporary files and Gradle's home, is in its home, named by system properties, since a JVM takes
  its home from the system, not `HOME`. Its JVM looks names up only in an empty hosts file of Lo's,
  so it reaches no host: Buildship, inside it, asks services.gradle.org for Gradle's versions as it
  starts, whatever is imported, and no setting stops it. It doesn't start on a checkout whose root
  holds a `.settings`, which it would link its project's settings to, reading them and writing
  there. Above the checkout it reads nothing: when a folder the checkout is in is named `src`, it
  looks only for whether the folder holding that one has a build file, and makes no project if it
  has. Its heap is capped at 2.5 GB, under Lo's 4 GB for the group. It finds its project's folders
  only as it starts, so it restarts on another checkout rather than moving there (`stays`).

None runs in a sandbox: each reads what you can, so an absolute import, Pyright's `extraPaths`, the
folders of stubs a `.php-lsp.json` names, the paths a `composer.json`'s autoload names, or a
`composer.json` up to seven folders above the checkout, which php-lsp climbs to when the checkout
has none, lead it to files outside the checkout, and a hover can show what's in one. It only reads
there, and nothing can send what it reads anywhere. Lo never opens a place outside the checkout an
answer names: it shows as outside the repository.

Lo names each server's license wherever it says what the server is: a server's details in the status
bar show its name, version and license, "Pyright 1.1.414 · MIT".

## Downloads

`servers.json` pins what Lo downloads, and `scripts/pin.ts` writes it (see `AGENTS.md`).
`toolchains.json` pins the toolchains language servers use, Go, Rust, a Temurin JDK and the .NET
SDK, the same way, with what each unpacks to on each platform; `src/toolchains.ts` says what a
server gets of each. An `Installer` puts each version in `<folder>/<id>/<version>/`, the servers' in
`<cache>/servers/` and the toolchains' in `<cache>/toolchains/`, holding a download to these:

| What                       | Limit                                                                                    |
| -------------------------- | ---------------------------------------------------------------------------------------- |
| Addresses                  | `https`, the usual port, the entry's hosts by exact name                                 |
| Redirects                  | 5, each held to the same rules, and none followed unseen                                 |
| Room on the disk           | its files and what they unpack to, before it starts                                      |
| A file                     | the size the manifest pins, then its SHA-256                                             |
| Tries                      | 3, when the connection fails, the file comes short or a 5xx                              |
| A stall                    | nothing for 30 s, or under 16 KB in any 5 minutes                                        |
| What an archive unpacks to | 100,000 entries, and what it's recorded to unpack to and 5% more, or 2 GB where it isn't |
| A symbolic link's target   | 1 KB, relative, resolving inside                                                         |

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

A server that uses .NET runs only as `dotnet exec` (`checkArguments` in `src/process.ts`), and only
on a checkout `checkoutProblem` finds no `global.json` in, nor above, that names `paths` or spells a
key with an escape: that file can send the SDK's commands, and MSBuild, to an SDK in the checkout,
whatever the variables say.

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

An installed file's bytes: before each use, its size is checked, not its hash, which would read
every byte. On macOS, `fsync` leaves what the drive itself caches, and Node can't ask for more
(`F_FULLFSYNC`), so a power loss there can still lose some of an install: a file cut short or gone
is caught by the marker, one of the right size with the wrong bytes isn't.
