# CP-2: Scoped closeout disambiguation

`completeTask()` now removes the stale `backlog/tasks/` candidate when exactly
two ambiguous candidates comprise one open file and one completed file. The
canonical completed record remains the sole resolvable task file.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Closeout removes the stale open candidate | `src/adapters/backlog/task-transitions.ts`; `npm test -- test/task-2524-slug-duplicate-closeout-repro.test.ts` | Complete |
| Ambiguity is retained before closeout | "TASK-2524: completeTask closes the sole open slug-prefix twin without hiding ambiguity" in `test/task-2524-slug-duplicate-closeout-repro.test.ts` | Complete |
| The canonical record resolves after closeout | `test/task-2524-slug-duplicate-closeout-repro.test.ts`; `src/application/integrate/squash.ts` | Complete |

Next action: extend the committed backlog integrity check to report differing filename twins that share a slug prefix.
