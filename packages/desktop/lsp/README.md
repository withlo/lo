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
| A stop                              | 4.5 s                                      |

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

## A server's family

A server leads a process group of its own. Its family is that group and every process descended from
a member of it, found by parent ID, so a process that left the group by starting a session of its
own (`setsid`) is still found.

- A stop reads the family while the server shuts down and again as `exit`'s second ends, each read
  within those waits, sends `SIGTERM` to all of it once `exit` has had its second, and 2 s later
  kills what's left, as below. At most 4.5 s in all: 1 s, 1 s, 2 s, the freeze's 400 ms and 100 ms
  for the kill to land.
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
- A family still finding new processes after 8 rounds or 400 ms: what's frozen is killed, and a
  process started in the last round isn't. Only processes not yet frozen can start one, and each
  round freezes all it finds, so this takes a process that starts others faster than Lo can read.
- A read of the family has 250 ms. If it takes longer, or fails, only the group, and what was found
  before, is signalled.

## Servers

The servers Lo runs, each downloaded on first use for a trusted view, as `servers.json` pins it, and
each with its adapter in `src/adapters/`. All three run on Lo's own Node, which downloads first, and
need nothing installed.

| Server       | Version | For                    | From                                                                               | License                                                                                                  |
| ------------ | ------- | ---------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| vtsls        | 0.3.0   | TypeScript, JavaScript | npm: `@vtsls/language-server` and its 17 dependencies, TypeScript 5.9.3 among them | MIT; TypeScript's is Apache-2.0, the rest MIT or ISC                                                     |
| Pyright      | 1.1.414 | Python                 | npm: `pyright`                                                                     | MIT                                                                                                      |
| Intelephense | 1.18.5  | PHP                    | npm: `intelephense` alone, which has its dependencies built in                     | proprietary: the Intelephense Licence, `LICENSE.txt` in its package; closed code, used free, with no key |
| Node         | 26.13.1 | the three above        | nodejs.org                                                                         | MIT                                                                                                      |

Each starts as Node, by its absolute path, with a cap on its heap, then its own entry point inside
its install, never the launcher npm would link, with no shell and an environment built from nothing.
What it's told is its adapter's alone, and the adapter says why each setting is as it is:

- **vtsls** runs its own TypeScript, never a workspace's (`node_modules/typescript`), loads no
  `tsserver` plugin but those beside its own TypeScript, and has automatic type acquisition off, so
  it runs no npm. `tsserver`'s heap is capped at 3 GB and vtsls's at 512 MB, under Lo's 4 GB for the
  group.
- **Pyright** is given `/dev/null` as its Python, which can't run, so it runs no interpreter: not
  the machine's, nor one a checkout's virtual environment or `.python-version` would pick. It
  answers from the checkout and the standard library's stubs it carries.
- **Intelephense** gets no license key, so its paid features, inlay hints among them, refuse. Its
  telemetry is off, and its storage is in the server's own `HOME`. Lo names its license wherever it
  says what the server is: a server's details in the status bar show its name, version and license,
  "Intelephense 1.18.5 · proprietary".

## Downloads

`servers.json` pins what Lo downloads, and `scripts/pin.ts` writes it (see `AGENTS.md`). An
`Installer` puts each version in `<cache>/servers/<id>/<version>/`, holding a download to these:

| What                       | Limit                                                       |
| -------------------------- | ----------------------------------------------------------- |
| Addresses                  | `https`, the usual port, the entry's hosts by exact name    |
| Redirects                  | 5, each held to the same rules, and none followed unseen    |
| A file                     | the size the manifest pins, then its SHA-256                |
| Tries                      | 3, when the connection fails, the file comes short or a 5xx |
| A stall                    | 30 s with nothing come, which counts as a failed connection |
| What an archive unpacks to | 100,000 entries and 2 GB                                    |
| A symbolic link's target   | 1 KB, relative, resolving inside                            |

Nothing is unpacked before its hash matches, and nothing is used before its marker says it's whole.
Absolute paths, `..`, hard links, devices and pipes are refused, and files are written before any
link is made, so nothing is written through one.

Each file and folder unpacked is synced to the disk, then the marker, then the folder that holds
them, and only then is it renamed into place. The marker records the fingerprint of the download and
of the rules it was unpacked under (`UNPACK_RULES` in `src/unpack.ts`, raised whenever they change),
and each file's size and each link's target. Before an install is used, each file and link is
checked against it, by what the system knows of it, never its bytes.

### What isn't checked

What a program does once it runs: the hash says it's the file that was pinned, and the signature
`pin.ts` checked then says who published it, not what it does. That's what trust and each server's
environment are for.

An installed file's bytes: before each use, its size is checked, not its hash, which would read
every byte. On macOS, `fsync` leaves what the drive itself caches, and Node can't ask for more
(`F_FULLFSYNC`), so a power loss there can still lose some of an install: a file cut short or gone
is caught by the marker, one of the right size with the wrong bytes isn't.
