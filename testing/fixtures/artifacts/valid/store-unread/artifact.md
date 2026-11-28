---
format: 1
pr: 4797
commit: a08fba8e2a6dd7a5b35a34d1c1efd71a59252e87
---

## tl;dr

Requests over a quota now wait in a [bucket](term:bucket) instead of failing.

## Glossary

- **Bucket** (new): the credits a tenant has to spend.
