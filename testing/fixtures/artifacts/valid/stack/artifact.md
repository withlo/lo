---
format: 1
stack: 4790
commit: a08fba8e2a6dd7a5b35a34d1c1efd71a59252e87
---

## tl;dr

The stack makes requests over a quota wait for a [token](term:token) instead of failing: the
bottom layer adds the limiter, and the layers above it use it.

## How the layers fit

Each layer builds on [the limiter's bucket](code:src/limiter.ts#L3-L12).

## Glossary

- **Token**: what a request spends to go through.
