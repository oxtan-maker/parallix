# CP-2 — Checked lifecycle recovery boundary

Implemented `px recover <slug>` over the Mission authority. It reports the worktree task and aggregate states, recovers only `active` task plus `done` aggregate conflicts, and writes a `recover-active` lane event with the aggregate update. An `integrate` lane event is a durable refusal guard.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| TASK-2438-shaped conflict is reproducible and initially rejected | `test/task-2446-repro.test.ts`; `"TASK-2438-shaped active task and closed aggregate reports supported recovery and resumes active"` | Complete |
| Conflict reports both states and a recovery action | `src/interfaces/cli/recover.ts`; `px recover <slug>` | Complete |
| Non-integrated conflict resumes with history | `src/application/mission-lifecycle-recovery.ts`; `test/task-2446-repro.test.ts` | Complete |
| Integrated mission recovery is refused unchanged | `src/application/mission-lifecycle-recovery.ts`; `board_lane_events` | Pending focused coverage |
| TASK-2438 reaches compatible persisted states | `px recover task-2438` | Pending supported-path execution |
| Focused tests and static analysis pass | `npm test -- --test-name-pattern='TASK-2438-shaped active task and closed aggregate reports supported recovery and resumes active' test/task-2446-repro.test.ts` | Focused reproduction passes |

Next action: add the integrated-mission refusal and SQLite durability coverage, then run recovery against TASK-2438's persisted data or fixture.
