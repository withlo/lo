---
format: 1
pr: 4797
commit: a08fba8e2a6dd7a5b35a34d1c1efd71a59252e87
---

## tl;dr

Requests over a quota now wait for a token instead of failing.

## How it works

:::figure figures/colors.svg
The limiter and a bucket, drawn in colors that don't follow the theme.
:::

:::figure figures/plain.svg
The limiter, its label in one color of its own.
:::

