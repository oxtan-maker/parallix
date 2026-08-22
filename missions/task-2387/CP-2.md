# CP-2: Wire current work through board composition

Threaded the existing production `CurrentWorkPort` from application services through production and TUI composition into `BoardCommandController`, which now supplies it to `ExecuteMissionService`. The controller retains the no-op default for existing read-only/test callers.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Board controller forwards the recorder to execute | `src/application/controller/board-controller.ts`, `test/task-2387-board-current-work.test.ts` | PASS |
| Production TUI composition receives the process recorder | `src/composition/application-services.ts`, `src/composition/production-capabilities.ts`, `src/composition/board-projection.ts` | PASS |
| Red reproduction is green after wiring | `npx tsx --test test/task-2387-board-current-work.test.ts`, `"board active:execute publishes running and ended current work"` | PASS |
| Existing production capability composition typechecks | `npm run typecheck`, `test/production-composition-capabilities.test.ts` | PASS |

Next action: add a production-composition lifecycle assertion that proves the factory-delivered board controller publishes its current-work states.
