# CP-3 — Durable recovery safeguards

Added focused coverage for the two safety outcomes. The TASK-2438 durable SQLite fixture recovers through the supported application path and persists its `recover-active` history event; an aggregate with durable `integrate` history is refused without any write.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| TASK-2438-shaped conflict is reproducible and initially rejected | `test/task-2446-repro.test.ts`; `"TASK-2438-shaped active task and closed aggregate reports supported recovery and resumes active"` | Complete |
| Conflict reports both states and a recovery action | `src/interfaces/cli/recover.ts`; `px recover <slug>` | Complete |
| Non-integrated conflict resumes with history | `"TASK-2438 durable fixture persists recovery and its lane-history record"`; `test/task-2446-repro.test.ts` | Complete |
| Integrated mission recovery is refused unchanged | `"integrated mission recovery is refused without changing its aggregate or history"`; `test/task-2446-repro.test.ts` | Complete |
| TASK-2438 reaches compatible persisted states | `"TASK-2438 durable fixture persists recovery and its lane-history record"`; `test/task-2446-repro.test.ts` | Complete (durable fixture) |
| Focused tests and static analysis pass | `npm test -- --unit-test-headroom test/task-2446-repro.test.ts`; `./scripts/verify-local.sh static-analysis` | Focused tests pass; static analysis pending final gate |

Next action: execute the declared verification gates and record their durable results in CP-4.
