---
format: 1
pr: 4797
commit: 0000000000000000000000000000000000000000
---

## tl;dr

Requests over a quota now wait for a token instead of failing.

The header names a commit the repository doesn't have.

:::code src/limiter.ts#L1-L3
:::

[the config](code:src/config.ts)
