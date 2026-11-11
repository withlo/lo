---
format: 1
pr: 4797
commit: a08fba8e2a6dd7a5b35a34d1c1efd71a59252e87
---

## tl;dr

Requests over a quota now wait in a [bucket](term:bucket) instead of failing.

## How it works

:::figure figures/flow.svg
A request waits in its tenant's bucket for a token, then goes on to the API.

- [bucket](term:bucket)
- [limiter](code:src/limiter.ts#L36-L41)
- [timeout](#where-to-look)
:::

:::figure figures/flow.svg
The same request, with only the limiter linked.

- [limiter](code:src/limiter.ts#L36-L41)
:::

## Where to look

:::figure figures/shot.png
The settings page, where a tenant's quota is set.
:::

:::figure figures/photo.jpg
The dashboard, as a JPEG.
:::

:::figure figures/banner.jpeg
The same, named .jpeg.
:::

:::figure figures/loop.gif
A request waiting, as an animation.
:::

:::figure figures/lossy.webp
A lossy WebP.
:::

:::figure figures/lossless.webp
A lossless WebP.
:::

:::figure figures/moving.webp
An animated WebP.
:::

## Glossary

- **Bucket**: the tokens a tenant has to spend.
