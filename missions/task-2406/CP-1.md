# CP-1 — draft current-work reproduction (red)

Added a mocked-port reproduction for draft current-work publication. The test
captures the missing normal-completion and error-path events without launching
an agent or touching operational storage. The focused run is intentionally red
against the pre-fix use case.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Normal draft publishes `running` then `ended` around its workflow | `test/task-2406-draft-current-work.test.ts`, `"draft publishes running with phase execute before workflow and ended after finalTransition"`, `npm test -- test/task-2406-draft-current-work.test.ts` | RED — expected failing reproduction |
| Thrown draft publishes `blocked` and preserves its error | `test/task-2406-draft-current-work.test.ts`, `"draft publishes blocked with the workflow error and rethrows it"`, `npm test -- test/task-2406-draft-current-work.test.ts` | RED — expected failing reproduction |
| Invalid slug remains non-publishing and non-throwing | `test/task-2406-draft-current-work.test.ts`, `"draft skips current-work publication for an unparseable slug"`, `npm test -- test/task-2406-draft-current-work.test.ts` | PASS |

Next action: implement the defaulted current-work seam in `DraftCommandUseCase` and wire the production recorder through CLI composition.
