# CP-2 — Durable live documentation

## Summary

Replaced the authority reference's source-tree and regression-test inventory
with the durable workflow, authority, verification, and limitation model.
Rewrote the use-case inventory as capability and confidence guidance, retaining
the important operational boundaries without making the documents a second copy
of implementation evidence.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Authority reference describes durable owners instead of entrypoint locations | `docs/authority-reference.md:31` | PASS |
| Authority reference has no bare implementation source paths | `docs/authority-reference.md:1` | PASS |
| Use cases retain capabilities and confidence limitations without test filenames | `docs/use-cases.md:7` | PASS |
| Use cases retain the reviewer-separation limitation | `docs/use-cases.md:36` | PASS |

Next action: Add deterministic documentation verification for implementation-evidence drift and relative Markdown link resolution.
