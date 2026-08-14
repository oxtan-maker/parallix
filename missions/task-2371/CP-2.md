# CP-2: Lifecycle alignment

Review-origin promotion now applies the existing authoritative `approve` transition before promoting Backlog state. A Mission already in `integration` is left unchanged; landing remains the only path to `done`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Review approval records one authoritative integration transition | test name `R1: backlog promotion cannot complete the Mission when landing fails`; `src/adapters/cli/commands/integrate-command.ts` | PASS |
| Failed landing remains integration with no done event | test name `R1: backlog promotion cannot complete the Mission when landing fails`; `npm test -- test/task-2369-regressions.test.ts` | PASS |
| Successful review-origin landing records integration then done | test name `R3: a review-origin integration completes only after the commit has landed`; `test/task-2369-regressions.test.ts` | PASS |
| Landing completion remains idempotent | test name `R2: an approved normal integration completes exactly once and a retry stays at one` | PASS |

Next action: add opposing completion-date versus telemetry-date Agent Performance regressions.
