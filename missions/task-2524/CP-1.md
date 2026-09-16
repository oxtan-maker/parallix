# CP-1: Closeout collision reproduction

Added a hermetic unit reproduction for an open task file and a differently named
completed slug-prefix twin. It asserts that global resolution stays ambiguous
while closeout advances the open file.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| The closeout collision is reproducible | `test/task-2524-slug-duplicate-closeout-repro.test.ts`; "TASK-2524: completeTask closes the sole open slug-prefix twin without hiding ambiguity" | Complete |
| Ambiguous global resolution remains locked | `test/task-2524-slug-duplicate-closeout-repro.test.ts`; `resolveTaskFile('task-2524', root)` assertion | Complete |
| Test is a hermetic unit test | `ADR 0057`; `test/task-2524-slug-duplicate-closeout-repro.test.ts` | Complete |

Next action: make `completeTask()` select the sole `backlog/tasks/` candidate only for this exact ambiguous closeout case.
