# CP-1

Reproduction coverage is now in place for the active-step post-execute `repairHandoff()` path. The new test drives a clean-exit handoff scenario with dirty mission/backlog artifacts plus repo-local implementation files under `lib/` and `test/`, and it currently fails because the repair seam rejects those implementation paths as "non-mission paths."

## Goal Check
| Criterion | Evidence | Status |
|---|---|---|
| Reproduction test exists for active-step handoff repair with ordinary implementation files | `test/task-2202-repair-handoff-autocommit.test.js`, `test/task-2202-repair-handoff-autocommit.test.js:6` | PASS |
| Parent behavior is locked red with the current "non-mission paths" blocker | `node --test test/task-2202-repair-handoff-autocommit.test.js`, `test/task-2202-repair-handoff-autocommit.test.js:44` | PASS |
| Expected green behavior is documented with deterministic staging and commit assertions | `test/task-2202-repair-handoff-autocommit.test.js:46`, `test/task-2202-repair-handoff-autocommit.test.js:52` | PASS |

Next action: trace `lib/commands/repair-handoff.ts` and `lib/core/mission-utils.ts` to document the current safe/unsafe path boundary in `missions/task-2202/CP-2.md`.
