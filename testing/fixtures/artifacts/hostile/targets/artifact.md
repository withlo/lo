---
format: 1
pr: 4797
commit: a08fba8e2a6dd7a5b35a34d1c1efd71a59252e87
---

## tl;dr

Requests over a quota now wait for a token instead of failing.

Targets that try to leave the repository, or reach what a path shouldn't:

[a](code:../../etc/passwd) [b](code:/etc/passwd) [c](<code:C:\Windows\win.ini>)
[d](code:.git/config) [e](code:src/.GIT/HEAD) [f](code:figures/../artifact.md)
[g](code:%2e%2e/%2e%2e/etc/passwd#L1) [h](code:src/limiter.ts#L99999999999999999999999999999)
[i](<code:src/evil‮st.ts>) [j](<code:.g‌it/config>)

Schemes that aren't code: [k](javascript:alert(1)) [l](data:text/html,x) [m](lo-app://window)
[n](code:javascript:alert(1))

Links and entries that aren't files:

[o](code:links/passwd#L1) [p](code:links/src/limiter.ts#L1) [q](code:vendor/lib#L1) [r](code:src#L1)
[s](code:names/cafe.ts) [t](code:src/CACHE.ts)
