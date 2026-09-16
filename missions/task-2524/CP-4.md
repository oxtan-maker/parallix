# CP-4: Drifted task-file cleanup

Removed the stale `backlog/tasks/` copies for TASK-2503, TASK-2518, and
TASK-2519. Their canonical `backlog/completed/` records remain and each is
already marked `done`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| TASK-2503 has only its canonical completed record | `backlog/completed/task-2503 - preserve-mission-identity-during-rebase.md`; `test/backlog_gate.test.ts` | Complete |
| TASK-2518 has only its canonical completed record | `backlog/completed/task-2518 - Keep-board-action-wire-vocabulary-in-sync.md`; `test/backlog_gate.test.ts` | Complete |
| TASK-2519 has only its canonical completed record | `backlog/completed/task-2519 - Shift-rigth.md`; `test/backlog_gate.test.ts` | Complete |
| Repository backlog integrity is clean | `npm test -- test/task-2524-slug-duplicate-closeout-repro.test.ts test/backlog_gate.test.ts` | Complete |

Next action: update the graph and run both mission-declared verification gates before finalizing CP-5.
