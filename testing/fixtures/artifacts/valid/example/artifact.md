---
format: 1
pr: 4797
commit: a08fba8e2a6dd7a5b35a34d1c1efd71a59252e87
---

## tl;dr

Requests over a quota now wait for a token instead of failing.

## How it works

The limiter takes a token from the tenant's [bucket](term:bucket) before it forwards a request:

:::code src/limiter.ts#L46-L61
:::

:::figure figures/flow.svg
A request waits for a token in its tenant's bucket, then goes on to the API.

- [bucket](term:bucket)
- [limiter](code:src/limiter.ts#L36-L41)
:::

:::walkthrough One request, start to finish
:::step src/limiter.ts#L16-L24
The limiter finds the tenant's bucket, and makes one on the tenant's first request.
:::
:::step src/limiter.ts#L47-L60
With no token free, the request waits, for up to [the timeout](code:src/config.ts#L8).
:::
:::step src/limiter.ts#L63-L67
A token coming back wakes the request that has waited longest.
:::
:::

## Where to look

:::tabs
:::tab Before
A burst over the quota failed at once.
:::
:::tab After
A burst over the quota waits, and fails only after the timeout.
:::
:::

:::fold Why not a queue per request
A queue per request would keep a timer for each one. The bucket keeps one timer per tenant.
:::

## How it was checked

The new test in [limiter.test.ts](code:src/limiter.test.ts) passes, as does [the rest](#how-it-works).

## Glossary

- **Bucket**: the tokens a tenant has to spend. Each request takes one.
