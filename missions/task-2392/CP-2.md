# CP-2: Read lifecycle state from the integration base

Corrected `ConcreteMissionReadAdapter` so a board read launched from a mission
worktree resolves that mission's integration-base worktree before reading its
authoritative task record. The mission worktree remains the source of allowed
descriptive fields; its status and assignee cannot become lifecycle authority.

The focused reproduction now exercises the concrete adapter from a mission
worktree, then materializes its card and builds the board projection.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: authoritative active lifecycle survives a differing worktree record | `src/adapters/backlog/concrete-mission-read-adapter.ts`, `test/task-2392-active-lane-repro.test.ts` | PASS |
| SC2: the card is only in ACTIVE | `"task-2392: active task appears in active stage, not backlog"`, `npx tsx --test test/task-2392-active-lane-repro.test.ts` | PASS |
| SC3: stage membership derives from `MissionCard.lane` | `src/application/projections/mission-board.ts`, `src/application/projections/board.ts` | PASS |
| SC4: reproduction is red without the integration-base read and green with it | `test/task-2392-active-lane-repro.test.ts` | PASS |
| SC5: final repository gate | `./scripts/verify-local.sh all` | PENDING: CP-3 |

Next action: Run the focused regression and `./scripts/verify-local.sh all`, then record their completed evidence in CP-3.
