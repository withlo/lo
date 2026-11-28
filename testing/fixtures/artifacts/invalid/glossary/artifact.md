---
format: 1
pr: 4797
commit: a08fba8e2a6dd7a5b35a34d1c1efd71a59252e87
---

## tl;dr

Requests over a quota now wait for a token instead of failing.

A [bucket](term:bucket), a [token](term:token), a [hash map](<term:Hash  Map>) and
[nothing](<term:>), and a [limit](term:limit).

## Glossary

Terms:

- **Bucket**: tokens.
- **BUCKET**: tokens again.
- **hash  map**: a map.
- **Hash map**: the same map.
- Token: no bold.
- **[Linked](code:src/limiter.ts)**: a link inside.
- **Quota** (New): a mark in capitals.
- **Limit** (new): the most a **bucket** holds, which merging would store.
