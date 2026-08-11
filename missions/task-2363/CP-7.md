# CP-7 — Production certification

Added a production-path certification that seeds a real temporary Git primary repository and linked worktree plus a migrated SQLite database. The fixture persists 240 old completed missions, 28 previous-window missions, 31 current-window missions, and one open mission through production repositories. The test reaches `ConcreteMetricsReadAdapter`, `BoardProjectionBuilder`, and FLOW rendering with a fixed clock; it provides no launcher and explicitly returns no running sessions.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Real Git, linked worktree, and migrated SQLite are used | `test/task-2363-production-certification.test.ts`, "keeps 240 historical rows out of the hand-computed current weekly FLOW population" | PASS |
| Current and previous window populations use a hand-computed oracle | `test/task-2363-production-certification.test.ts`, exact assertions for current `n=31`/40 min and previous `n=28`/140 min | PASS |
| Contaminated history cannot change current metrics | `test/fixtures/task-2363-certification-fixture.ts`, `test/task-2363-production-certification.test.ts` | PASS |
| Production metrics flow reaches BoardProjectionBuilder and FLOW | `test/task-2363-production-certification.test.ts`, `ConcreteMetricsReadAdapter` → `BoardProjectionBuilder` → `FlowPanel` | PASS |
| No agent, LLM, runner, or network path is invoked | `test/task-2363-production-certification.test.ts`, injected empty `loadRunningSessions` and no launcher dependency | PASS |
| Certification passes | `npx tsx --test test/task-2363-production-certification.test.ts` | PASS |

Next action: execute CP-8 regression-sensitivity proof by temporarily restoring the former all-history and identity/null-collapse behavior, then restore the committed implementation.
