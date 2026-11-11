---
format: 1
pr: 4797
commit: a08fba8e2a6dd7a5b35a34d1c1efd71a59252e87
---

## tl;dr

Requests over a quota now wait for a token instead of failing.

Paths are matched exactly, so each of these is its own file:

- [a space](<code:docs/read me.md>), and [a #](code:docs/a#b.md#L1)
- [in capitals](code:src/Cache.ts#L1-L2) and [in lower case](code:src/cache.ts#L2)
- [composed](code:names/café.ts#L1) and [decomposed](code:names/café.ts#L1)
- [lines ending in CRLF](code:crlf.txt#L3), and [an empty file](code:empty.txt)
- [a binary file](code:assets/logo.png), named whole
- [a file past the limit](code:big/huge.txt), named whole
- [a folder named %2e%2e is just a name](code:src/limiter.ts#L1)
