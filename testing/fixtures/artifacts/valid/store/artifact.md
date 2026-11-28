---
format: 1
pr: 4797
commit: a08fba8e2a6dd7a5b35a34d1c1efd71a59252e87
---

## tl;dr

Requests over a quota now wait in a [bucket](term:bucket) for a [credit](term:credit) instead of
failing, and each of the [tenants](term:tenants) gets one bucket.

## Glossary

- **Bucket** (new): the [credits](term:credit) a tenant has to spend.
- **Credit** (changed): what a request spends to go through, one each.
- **Tenants**: the accounts the quota is
  counted for.
