---
format: 1
pr: 4797
commit: a08fba8e2a6dd7a5b35a34d1c1efd71a59252e87
---

## tl;dr

A [bucket](term:bucket), a [credit](term:credit), a [tenant](term:tenant), a [quota](term:quota)
and a [limit](term:limit).

## Glossary

- **Bucket**: the credits a tenant has.
- **Credit** (new): what a request spends.
- **Tenant** (changed): the accounts the quota is counted for.
- **Quota**: how many requests a tenant may make.
- **Limit** (changed): the most a *bucket* holds.
