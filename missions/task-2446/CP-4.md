# CP-4 — Verified recovery path

Completed the recovery path and its gates. `px recover <slug>` reports the task/aggregate pair, resumes only a non-integrated `active`/`done` split through the checked store, and preserves the lane-history audit. The recovery write maps an optimistic-concurrency conflict to the standard structured `conflict` outcome.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| TASK-2438-shaped conflict is reproducible and initially rejected | `test/task-2446-repro.test.ts`; `"TASK-2438-shaped active task and closed aggregate reports supported recovery and resumes active"` | Complete |
| Conflict reports both states and a recovery action | `px recover <slug>`; `src/interfaces/cli/recover.ts` | Complete |
| Non-integrated conflict resumes with history | `"TASK-2438 durable fixture persists recovery and its lane-history record"`; `test/task-2446-repro.test.ts` | Complete |
| Integrated mission recovery is refused unchanged | `"integrated mission recovery is refused without changing its aggregate or history"`; `test/task-2446-repro.test.ts` | Complete |
| TASK-2438 reaches compatible persisted states | `"TASK-2438 durable fixture persists recovery and its lane-history record"`; `test/task-2446-repro.test.ts` | Complete (durable fixture) |
| Focused tests and static analysis pass | `"recovery reports a stale lifecycle write as a conflict"`; `test/task-2446-repro.test.ts`; `npm test -- --unit-test-headroom test/task-2446-repro.test.ts`; `./scripts/verify-local.sh all`; `./scripts/verify-local.sh static-analysis` | Complete |

Next action: hand off the committed mission for review; operators can run `px recover task-2438` against the available durable state.
