# CP-1 — Dependency graph validator

Replaced the infrastructure-name enforcement path with a six-layer import
classifier and graph validator. The validator scans every declared layer root,
resolves local static imports, and reports only edges whose source-to-target
layer direction is not in the ADR 0051 graph. The existing application-boundary
assertions retain their current helper and assertions while the new validator
becomes the architecture enforcement mechanism.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: Layer classification and graph-based enforcement replace the blacklist | `src/platform/runtime/lib/architecture/boundary-guards.ts:64`; `src/platform/runtime/lib/architecture/boundary-guards.ts:73` | PASS |
| SC2: The declared graph has the six intended directions | `src/platform/runtime/lib/architecture/boundary-guards.ts:19`; ADR 0051 | PASS |
| SC3: All six roots are scanned and forbidden directed edges are reported | `src/platform/runtime/lib/architecture/boundary-guards.ts:9`; `src/platform/runtime/lib/architecture/boundary-guards.ts:77` | PASS |
| SC7: Existing application-boundary assertions remain unchanged and pass | `test/application-boundaries.test.ts`; `node --import tsx --test test/application-boundaries.test.ts` | PASS |

Next action: create `dependency-graph-allowlist.ts` from the 16 records reported by `findDependencyViolations()` and attach task ownership plus a removal mission to each record.
