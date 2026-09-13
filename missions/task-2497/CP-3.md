# CP-3 — Refused recovery cannot resume review work

The recover command now has a focused regression proving that a landed active
mission returns the non-resume result. It does not save a reopened aggregate or
signal a handoff/review continuation.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Landed active mission does not resume workflow work | `test/task-2446-repro.test.ts`, `"TASK-2492: recover command does not resume a landed active mission"` | PASS |
| Recovery command returns the refused outcome to its caller | `src/interfaces/cli/recover.ts`, `npm test -- test/task-2446-repro.test.ts` | PASS |
| Existing recovery behavior remains covered | `test/task-2446-repro.test.ts`, `"TASK-2438-shaped active task and closed aggregate reports supported recovery and resumes active"` | PASS |

Next action: add cleanup-on-landed detection with one invocation and a durable failure result.
