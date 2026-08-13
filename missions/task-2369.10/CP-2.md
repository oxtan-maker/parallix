# CP-2 — Extract mission importer parsing

Moved the 18 mapped parsing, normalization, review, checkpoint, and filesystem helpers into `mission-import-parsing.ts`. `MissionCompatibilityImporter` now keeps SQLite orchestration and delegates discovery/candidate construction and comparison helpers to that module. Added direct no-importer tests, while the existing importer suite continues to cover integration behavior.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 — standalone functions cover all 18 responsibilities | `src/adapters/sqlite/mission-import-parsing.ts`, `test/mission-import-parsing.test.ts` | PASS |
| SC2 — importer delegates and is below the line limit | `src/adapters/sqlite/mission-importer.ts`, `wc -l src/adapters/sqlite/mission-importer.ts` | PASS |
| SC3 — importer behavior remains covered through delegation | `test/task-2322.04-mission-import.test.ts`, `node --test --import tsx test/task-2322.04-mission-import.test.ts` | PASS |
| SC4 — direct tests run without an importer instance, including fallback cases | `test/mission-import-parsing.test.ts`, `node --test --import tsx test/mission-import-parsing.test.ts` | PASS |
| SC5 — required final gates are pending | `./scripts/verify-local.sh static-analysis`, `./scripts/verify-local.sh all` | PENDING (CP-3) |

Next action: Run the mission static-analysis gate, then the complete local verifier and record final evidence in CP-3.
