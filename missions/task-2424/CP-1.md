# CP-1 — Lifecycle reproduction retained

The deterministic reproduction now mounts `BoardShell`, supplies a controlled projection subscription, delivers exactly three updates, then unmounts. It proves cleanup runs once, removes the live callback, and prevents a captured post-unmount callback from redrawing. The mission parent remains green because this lifecycle cleanup predates task-2424.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 controlled subscription and exactly three updates | `test/task-2424-repro.test.ts`, `test/task-2424-repro-body.ts` | PASS |
| SC2 unmount removes the projection callback | `test/task-2424-repro.test.ts`, `node --test test/task-2424-repro.test.ts` | PASS |
| SC3 requires a red parent reproduction | `git show 7a89079a8`, `src/interfaces/tui/shell.tsx:112` | BLOCKED — parent is already green |
| SC4 live refresh ownership and timer cleanup | `src/interfaces/tui/ui-command.ts`, `src/application/projections/board-subscription.ts` | ALREADY SATISFIED |
| SC5 headless and resize cleanup boundaries | `test/tui-headless-isolation.test.ts`, `test/task-2313-repro.test.ts` | NOT MODIFIED |
| SC6 focused regression command | `node --test test/task-2424-repro.test.ts`, `test/task-2424-repro.test.ts` | PASS |
| SC7 general verification command | `./scripts/verify-local.sh all`, `test/task-2424-repro.test.ts` | PASS |

Next action: preserve the established owner cleanup and record the focused and full gate results.
