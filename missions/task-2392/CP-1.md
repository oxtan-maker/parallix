# CP-1: Active-lane reproduction

Added the focused board-projection reproduction. It creates an authoritative
`active` lifecycle record and a same-ID worktree record with `backlog` status
plus newer descriptive fields, then verifies the resulting board card appears
once in ACTIVE and never in BACKLOG.

The reproduction is already green on the mission parent: its
`materializeBacklogMission` and `boardLane` implementations match the locked
tree. The captured wrong-lane state therefore cannot be reproduced through
the required authoritative materialization and board-projection path.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: authoritative active lifecycle survives a differing worktree record | `test/task-2392-active-lane-repro.test.ts`, `"task-2392: active task appears in active stage, not backlog"` | PASS |
| SC2: the card is only in ACTIVE | `test/task-2392-active-lane-repro.test.ts`, `npx tsx --test test/task-2392-active-lane-repro.test.ts` | PASS |
| SC3: stage membership derives from `MissionCard.lane` | `src/application/projections/mission-board.ts`, `src/application/projections/board.ts` | PASS |
| SC4: the required red reproduction exists against the mission parent | `test/task-2392-active-lane-repro.test.ts`, mission parent `58718836c` | BLOCKED: parent is already green |
| SC5: final repository gate | `./scripts/verify-local.sh all` | NOT RUN: stop rule applies before a correction |

Next action: Stop the mission because CP-1 cannot reproduce the captured wrong-lane scenario through the required production materialization and projection path.
