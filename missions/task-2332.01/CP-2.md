# CP-2 — Legacy dependency exception inventory

Ran the graph validator across all six declared roots and captured all 16
current forbidden local edges in a narrow allowlist. The records name either
TASK-2332.02 (composition ownership) or TASK-2332.03 (application-owned ports)
as their owner and removal mission; no production module was moved or refactored.
The production validator applies this allowlist and reports no remaining
unowned violations.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC3: All six layer roots are evaluated | `src/platform/runtime/lib/architecture/boundary-guards.ts:9`; `src/platform/runtime/lib/architecture/boundary-guards.ts:77` | PASS |
| SC4: Every installation-time violation is explicitly owned and assigned to a removal mission | `src/platform/runtime/lib/architecture/dependency-graph-allowlist.ts:8`; `src/platform/runtime/lib/architecture/dependency-graph-allowlist.ts:24` | PASS |
| SC4: The production validator honors only the explicit exception inventory | `src/platform/runtime/lib/architecture/boundary-guards.ts:95`; `node --import tsx -e "...findProductionDependencyViolations(process.cwd())..."` | PASS |

Next action: add `test/dependency-graph.test.ts` with one named permitted-edge test per layer, an unallowlisted forbidden-edge regression, and an allowlist-honored assertion.
