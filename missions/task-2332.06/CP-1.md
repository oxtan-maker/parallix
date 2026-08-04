# CP-1 — inventory and executable boundary guard

Recorded the complete 86-file platform ownership ledger, moved the dependency
scanner into `src/adapters/architecture`, and added a regression check that
detects a legacy `src/platform/` tree even when it creates no import edge.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Every initial platform file has a final ownership destination | `missions/task-2332.06/platform-module-inventory.md:8` | PASS |
| Architecture guard is owned by a final layer | `src/adapters/architecture/boundary-guards.ts:5` | PASS |
| A legacy platform path is rejected independently of import scanning | `test/dependency-graph.test.ts:103`; "platform-path guard rejects a production legacy directory even without an import edge" | PASS |
| Canonical layer edges remain executable | `test/dependency-graph.test.ts:38`; `npx tsx --test test/dependency-graph.test.ts` | PASS |
| Durable-state inventory excludes the relocated architecture guard without a dead legacy path | `test/persistence-inventory-guardrail.test.ts:515`; "SC1 reverse: all durable-IO files under src/ are present in the inventory" | PASS |

Next action: move core filesystem, Git, process, configuration, verification, storage, and packaged-asset modules into their mapped adapter paths and update their callers.
