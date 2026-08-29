# CP-2 — Existing lifecycle owner verified

The ownership chain is already correct in the mission parent: `ui-command` supplies the live subscription, `BoardShell` returns that subscription's cleanup from its effect, and `subscribeToBoardProjection` stops and clears the pending timer. The cleanup was introduced by committed task-2370 work, so there is no smaller valid production correction to make.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 controlled subscription and exactly three updates | `test/task-2424-repro.test.ts`, `test/task-2424-repro-body.ts` | PASS |
| SC2 unmount removes the projection callback | `test/task-2424-repro.test.ts`, `node --test test/task-2424-repro.test.ts` | PASS |
| SC3 requires a red parent reproduction | `git show 7a89079a8`, `src/interfaces/tui/shell.tsx:112` | BLOCKED — parent is already green |
| SC4 keeps live updates while mounted and clears the pending refresh timer on unsubscribe | `src/interfaces/tui/ui-command.ts`, `src/application/projections/board-subscription.ts`, `test/task-2373-refresh-performance.test.ts` | ALREADY SATISFIED |
| SC5 preserves lazy headless loading and terminal resize cleanup | `test/tui-headless-isolation.test.ts`, `test/task-2313-repro.test.ts` | NOT MODIFIED |
| SC6 focused regression command | `node --test test/task-2424-repro.test.ts`, `test/task-2424-repro.test.ts` | PASS |
| SC7 general verification command | `./scripts/verify-local.sh all`, `test/task-2424-repro.test.ts` | PASS |

Next action: retain the stop-rule finding in the final checkpoint; do not add a duplicate cleanup or alter refresh behavior.
