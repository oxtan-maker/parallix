# CP-1: Red board current-work reproduction

Added a controller-boundary reproduction that dispatches `active:execute` with an in-memory `CurrentWorkPort` spy. It is intentionally red at the parent implementation: the board controller drops the recorder and the spy receives no `running` or `ended` publication.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Board execute has a red reproduction at the real controller boundary | `test/task-2387-board-current-work.test.ts`, `"board active:execute publishes running and ended current work"` | PASS |
| Parent behavior demonstrably drops current-work publication | `npx tsx --test test/task-2387-board-current-work.test.ts` fails the `running` assertion in `test/task-2387-board-current-work.test.ts` | PASS |
| Reproduction uses no real storage or process | `test/fixtures/execute-mission-ports.ts`, `test/task-2387-board-current-work.test.ts` | PASS |

Next action: thread the existing production `CurrentWorkPort` through TUI composition into `BoardCommandController` and make this reproduction green.
