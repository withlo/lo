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
| Its family's resident memory        | 4 GB unless its spec says, read every 5 s  |
| Requests                            | 8 at the server, 64 waiting, 32 unanswered |
| Open files                          | 50                                         |
| A stop                              | 4.9 s                                      |

A server past any of the first six is killed at once, whatever its state, a stop's included. One
whose memory can't be read three times running is stopped, since its cap would go unenforced.

No real server comes near the rates: a large workspace's diagnostics are thousands of messages over
many seconds, and the largest answers a few megabytes. Below them, a flood still can't keep main
from its turns. The connection handles one message a turn, so Lo hands it one a turn, and reads more
of the server's output only while fewer than 512 messages, or 1 MB of them, wait. The rest waits in
the pipe. Once `shutdown` is answered, or given up on, nothing more is read at all, so however much
a server sends, a stop keeps its time.

## A server's family

A server leads a process group of its own. Its family is that group and every process descended from
a member of it, found by parent ID, so a process that left the group by starting a session of its
own (`setsid`) is still found.

- A stop reads the family while the server shuts down, sends `SIGTERM` to all of it once `exit` has
  had its second, and 2 s later kills what's left, as below.
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
