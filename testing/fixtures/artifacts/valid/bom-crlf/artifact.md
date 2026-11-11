---
format: 1
pr: 4797
commit: a08fba8e2a6dd7a5b35a34d1c1efd71a59252e87
---

## tl;dr

Requests over a quota now wait for a token instead of failing.

A byte-order mark and Windows line endings are read as any other.

:::code src/config.ts#L7-L9
:::
