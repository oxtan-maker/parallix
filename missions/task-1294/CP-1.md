# CP-1 — Live documentation inventory

## Summary

Audited the four live authored documentation surfaces against their canonical
owners. The inventory establishes the regression baseline for the anti-drift
check: implementation locations and test inventories belong to source and test
authorities, while authored documentation keeps durable capability, invariant,
and rationale statements.

| Surface | Finding | Canonical owner | Classification |
|---|---|---|---|
| `docs/authority-reference.md` | CLI entrypoint list and backlog/measurement implementation locations | Runtime source and configuration | Remove from authored prose |
| `docs/authority-reference.md` | Verification and integration configuration examples | Configuration schema and configured commands | Keep only stable configuration guidance |
| `docs/use-cases.md` | Named test files, source locations, and external retrospective line citations | Tests, source, and measured records | Replace with durable confidence and limitation statements |
| `docs/doc-standards.md` | Guidance that treats paths and test names as durable documentation evidence | Documentation standard | Replace with the single-source rule |
| `README.md` | User-facing workflow and capability descriptions | Product behavior | Keep concise explanatory guidance; verify links |

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Inventory captures volatile locations in the authority reference | `docs/authority-reference.md:17` | PASS |
| Inventory captures test-inventory evidence in use cases | `docs/use-cases.md:29` | PASS |
| Inventory covers the documentation standard and README surfaces | `docs/doc-standards.md:1`, `README.md:1` | PASS |

Next action: Replace the inventoried implementation evidence with durable workflow, capability, limitation, and rationale statements in the two live reference documents.
