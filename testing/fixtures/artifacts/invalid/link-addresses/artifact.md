---
format: 1
pr: 4797
commit: a08fba8e2a6dd7a5b35a34d1c1efd71a59252e87
---

## tl;dr

Requests over a quota now wait for a token instead of failing.

A space ends a link's address, so Markdown makes no link of these, and they show as text:

- [a term](term:wake timer), [a path](code:docs/read me.md#L1) and [a section](#how it works)
- [a hand-wrapped term](term:wake
  timer) and [one with *emphasis*](term:wake *timer* now)
- [an open parenthesis](code:src/limiter(1.ts)
- [a tab](term:wake	timer)

With the address inside `<` and `>`, or with no space in it, each is a link:

- [a term](<term:wake timer>), [a path](<code:docs/read me.md#L1>) and [a section](#how-it-works)
- [a term with no space](term:wake-timer), [a path with parentheses](code:src/limiter.ts#L1-L2)

Where Markdown reads no link in the first place, there's nothing to fix:

- `[in a code span](term:wake timer)` and \[escaped\](term:wake timer)
- [a web page](https://example.com/a b) isn't an address of the format's
- ![an image](term:wake timer)

```text
[in a fence](term:wake timer)
```

## How it works

Each request takes a token.

## Glossary

- **Wake timer**: what wakes a request that waited.
- **Wake-timer**: the same, hyphenated.
