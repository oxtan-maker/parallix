# CP-4 — Final verification

Both declared verification gates passed on the final implementation tree. The
graph guard permits only the six declared directions, and the production scan
is clean after applying the 25 explicit legacy records. Those records remain
temporary: TASK-2332.02 owns the composition-construction exceptions and
TASK-2332.03 owns the application-to-SQLite-port exceptions.
The composition layer's canonical target is `src/composition`. The existing
`src/platform/runtime` and package-owned `src/platform/assets` trees remain
explicit migration-only scan roots, so CLI entry delegation and runtime asset
access are still evaluated as composition edges while legacy
adapter/interface-to-composition imports remain explicit TASK-2332.02 records.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: Layer classification plus graph edges are the enforcement mechanism | `src/platform/runtime/lib/architecture/boundary-guards.ts:73`; `src/platform/runtime/lib/architecture/boundary-guards.ts:82` | PASS |
| SC2: The six permitted directions exactly match the intended architecture | `src/platform/runtime/lib/architecture/boundary-guards.ts:28`; ADR 0051 | PASS |
| SC3: The validator scans every canonical and migration-only layer root and reports forbidden directed edges | `src/platform/runtime/lib/architecture/boundary-guards.ts:9`; `src/platform/runtime/lib/architecture/boundary-guards.ts:19`; `src/platform/runtime/lib/architecture/boundary-guards.ts:86`; "dependency graph keeps legacy package runtime assets classified during migration" | PASS |
| SC4: All 25 existing violations are explicit, owned, and scheduled for removal | `src/platform/runtime/lib/architecture/dependency-graph-allowlist.ts:8`; `src/platform/runtime/lib/architecture/dependency-graph-allowlist.ts:33` | PASS |
| SC5: Each of the six layers has named graph coverage | "dependency graph validates domain layer imports without unallowlisted violations"; "dependency graph validates entry layer imports without unallowlisted violations" | PASS |
| SC6: A new forbidden edge fails unless it is explicitly allowlisted | "dependency graph rejects a forbidden unallowlisted application-to-adapter edge immediately" | PASS |
| SC7: Existing application-boundary assertions still pass | `test/application-boundaries.test.ts`; `./scripts/verify-local.sh all` | PASS |
| SC8: Static analysis and general verification pass | `./scripts/verify-local.sh static-analysis`; `./scripts/verify-local.sh all` | PASS |

Next action: TASK-2332.02 must remove the composition-owned exception records before TASK-2332.03 moves the remaining SQLite-port contracts into application ownership.
