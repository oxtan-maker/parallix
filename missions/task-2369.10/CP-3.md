# CP-3 — Verify extracted importer parsing

Confirmed the importer remains at 1,019 physical lines and the direct parsing tests plus the existing importer regression suite pass. Repaired two pre-existing test-typecheck defects exposed by the required static-analysis gate: the board session map now has an explicit `RunningAgentSession[]` fallback, and the review fixture supplies the current required pull-request and retry fields.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 — all 18 standalone parsing responsibilities are exported | `src/adapters/sqlite/mission-import-parsing.ts`, `test/mission-import-parsing.test.ts` | PASS |
| SC2 — importer delegates and stays below 1,100 physical lines | `src/adapters/sqlite/mission-importer.ts`, `wc -l src/adapters/sqlite/mission-importer.ts` | PASS |
| SC3 — delegated importer preserves import and review behavior | `test/task-2322.04-mission-import.test.ts`, `node --test --import tsx test/task-2322.04-mission-import.test.ts` | PASS |
| SC4 — direct tests exercise every extracted responsibility and fallback behavior | `test/mission-import-parsing.test.ts`, `node --test --import tsx test/mission-import-parsing.test.ts` | PASS |
| SC5 — static analysis completes successfully | `./scripts/verify-local.sh static-analysis` | PASS |
| SC5 — complete local verifier completes successfully | `./scripts/verify-local.sh all` | PASS |

Next action: Hand off the committed mission branch with CP-1 through CP-3 and both required verification gates passing.
