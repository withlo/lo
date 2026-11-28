---
format: 1
pr: 4797
stack: 4790
commit: a08fba8e2a6dd7a5b35a34d1c1efd71a59252e87
---

## tl;dr

Requests over a quota now wait in a [bucket](term:bucket) for a [token](term:token) instead of
failing, and a [tenant](term:tenant) gets one bucket.

## Glossary

- **Bucket** (new): the [tokens](term:token) a tenant has to spend.
- **Token** (changed): what a request spends to go through, one each.
- **Tenant**: an account the quota is counted for.
