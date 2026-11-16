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

## A server's family

A server leads a process group of its own. Its family is that group and every process descended from
a member of it, found by parent ID, so a process that left the group by starting a session of its
own (`setsid`) is still found.

- A stop reads the family while the server shuts down, within that wait. Once `exit` has had its
  second, it freezes the group with `SIGSTOP`, reads the family again, sends `SIGTERM` to all of it,
  and lets the group go on with `SIGCONT` to the `SIGTERM` waiting for it. Frozen, nothing in the
  group can leave it, or start a process outside it, between that read and the signal. 2 s later it
  kills what's left, as below. At most 4.75 s in all: 1 s, 1 s, the read's 250 ms, 2 s, the freeze's
  400 ms and 100 ms for the kill to land.
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
  before, is signalled.

## Downloads

`servers.json` pins what Lo downloads, and `scripts/pin.ts` writes it (see `AGENTS.md`). An
`Installer` puts each version in `<cache>/servers/<id>/<version>/`, holding a download to these:

| What                       | Limit                                                       |
| -------------------------- | ----------------------------------------------------------- |
| Addresses                  | `https`, the usual port, the entry's hosts by exact name    |
| Redirects                  | 5, each held to the same rules, and none followed unseen    |
| A file                     | the size the manifest pins, then its SHA-256                |
| Tries                      | 3, when the connection fails, the file comes short or a 5xx |
| A stall                    | less than 16 KB in any 30 s, as a failed connection         |
| What an archive unpacks to | 100,000 entries and 2 GB                                    |
| A symbolic link's target   | 1 KB, relative, resolving inside                            |

A stall is too little progress in any 30 s that Lo waits for the network: less than 16 KB, about
half a kilobyte a second, so slow that only a connection that has all but stopped falls below it. A
host that sends nothing, or a byte now and then, is given up on, and a slow connection isn't.
There's no deadline for a whole download, which can be hundreds of megabytes. Headers are held to
the same rule: `fetch` gives an answer's headers whole, so each answer, a redirect's included, must
begin within 30 s of being asked for, as any connection that keeps to the rate does, since headers
are far smaller than 16 KB. The count starts again from each answer. Lo's own time between waits,
such as writing what came, doesn't count.

Nothing is unpacked before its hash matches, and nothing is used before its marker says it's whole.
Absolute paths, `..`, hard links, devices and pipes are refused, and files are written before any
link is made, so nothing is written through one.

Each file and folder unpacked is synced to the disk, then the marker, then the folder that holds
them, and only then is it renamed into place. The marker records the fingerprint of the download and
of the rules it was unpacked under (`UNPACK_RULES` in `src/unpack.ts`, raised whenever they change,
or what the marker records does), each file's size, each folder and each link's target. Before an
install is used, each is checked against it, by what the system knows of it, never its bytes: each
folder must still be a folder, not a link, so nothing below it is reached through one.

### What isn't checked

What a program does once it runs: the hash says it's the file that was pinned, and the signature
`pin.ts` checked then says who published it, not what it does. That's what trust and each server's
environment are for.

An installed file's bytes: before each use, its size is checked, not its hash, which would read
every byte. On macOS, `fsync` leaves what the drive itself caches, and Node can't ask for more
(`F_FULLFSYNC`), so a power loss there can still lose some of an install: a file cut short or gone
is caught by the marker, one of the right size with the wrong bytes isn't.
