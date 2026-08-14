# CP-9 — Regression verification and anti-slop audit (SC36–SC41)

## Summary of work done

The completed mission preserves the TASK-2370 architecture: one current-work
event authority, source publication in orchestration, no run/attempt aggregate,
and no authority reads in Ink. The focused composed workflow, real PTY, UI
boundary, and refresh suites pass 42/42. Static analysis and the full project
verifier both completed with terminal PASS results.

Anti-slop audit: changed current-work code uses the existing operational history
authority and in-place reconciliation; nested review is published at the loop
seam; the UI only renders projection facts; the SQLite index documents its sole
production query; unavailable commands render unavailable; no unconditional
`process.exit()` or new dependency/aggregate was introduced.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 | `test/task-2373-repro.test.ts`, six `"TASK-2373 defect …"` tests | PASS |
| SC2 | `test/task-2373-current-work-workflow.test.ts`, `"SC2: current work follows reviewer and implementer launches after handoff instead of the original implementer"` | PASS |
| SC3 | `test/task-2373-current-work-workflow.test.ts`, `"SC3: reviewer launches publish a review phase and implementer launches publish review-response"` | PASS |
| SC4 | `test/task-2373-current-work-workflow.test.ts`, `"SC4: three consecutive review rounds each update the same mission current work"` | PASS |
| SC5 | `test/task-2373-current-work-workflow.test.ts`, `"SC5: px review and px active publish nested review work through one seam"` | PASS |
| SC6 | `test/task-2373-current-work-workflow.test.ts`, `"SC6: claude blocked by usage limits and replaced by qwen keeps the mission WORKING throughout"` | PASS |
| SC7 | `test/task-2373-current-work-workflow.test.ts`, `"SC7: a delayed current-work publication lands before the next state is read"` | PASS |
| SC8 | `test/task-2373-operation-aware.test.ts`, `"SC8: a terminal event from a superseded operation leaves the newer work standing"` | PASS |
| SC9 | `test/task-2373-operation-aware.test.ts`, `"SC9: durable store order decides between two events written in the same millisecond"` | PASS |
| SC10 | `test/task-2373-needs-you.test.ts`, `"SC10: review-loop escalation during px active leaves the mission in NEEDS YOU with its reason"` | PASS |
| SC11 | `test/task-2373-needs-you.test.ts`, `"SC11: exhausted execute options survive into NEEDS YOU as the operator-facing reason"` | PASS |
| SC12 | `test/task-2373-needs-you.test.ts`, `"SC12: active work, failover, exhaustion, and dead work each project one truthful state"` | PASS |
| SC13 | `test/task-2373-liveness.test.ts`, `"SC13: a reused pid whose process-start identity differs is treated as dead"` | PASS |
| SC14 | `test/task-2373-liveness.test.ts`, `"SC14: an abnormally terminated publisher ages its work out instead of staying WORKING"` | PASS |
| SC15 | `test/task-2373-operator-rail.test.ts`, `"SC15: WORKING count either renders every live mission or states the hidden overflow"` | PASS |
| SC16 | `test/task-2373-operator-rail.test.ts`, `"SC16: bounded recovery evidence remains visibly WORKING with an uncertainty label"` | PASS |
| SC17 | `test/task-2373-operator-rail.test.ts`, `"SC17 and SC18: unavailable review and integration actions never render a green runnable affordance"` | PASS |
| SC18 | `test/tui-command-flow.test.ts`, `"Ctrl+R on card produces unavailable outcome without dispatching"` | PASS |
| SC19 | `test/task-2373-shutdown.test.ts`, `"SC19: q terminates a real idle px board and leaves its spawned PID gone"`; `session.pid` plus `processGone()` | PASS |
| SC20 | `test/task-2373-shutdown.test.ts`, `"SC20: Ctrl+C terminates a real idle px board and leaves its spawned PID gone"`; `session.pid` plus `processGone()` | PASS |
| SC21 | `test/task-2373-shutdown.test.ts`, modal `"TASK-2373 defect 6"` q and Ctrl+C tests | PASS |
| SC22 | `test/task-2373-shutdown.test.ts`, `"SC22: SIGTERM terminates the real interactive board cleanly"`; `session.pid` plus `processGone()` | PASS |
| SC23 | `test/task-2373-shutdown.test.ts`, `"SC19: q terminates a real idle px board and leaves its spawned PID gone"` | PASS |
| SC24 | `test/tui-command-flow.test.ts`, `"confirmed action dispatches through supplied controller and conflict refreshes before re-prompting"` | PASS |
| SC25 | `test/task-2373-shutdown.test.ts`, `terminalRestored()` assertions | PASS |
| SC26 | `test/task-2373-shutdown.test.ts`, `"SC26: ten real start-and-quit cycles leave every spawned board PID gone"`; `session.pid` plus `processGone()` | PASS |
| SC27 | `test/task-2373-shutdown.test.ts`, `"SC26: ten real start-and-quit cycles leave every spawned board PID gone"` | PASS |
| SC28 | `test/task-2373-repro.test.ts`, `"TASK-2373 defect 5: board current-work reads do not grow with historical current-work rows"` | PASS |
| SC29 | `test/task-2373-repro.test.ts`, `"TASK-2373 defect 5: board current-work reads do not grow with historical current-work rows"` | PASS |
| SC30 | `src/adapters/sqlite/migrations/0015-current-work-latest-per-mission.sql`, `test/task-2373-repro.test.ts` | PASS |
| SC31 | `test/task-2373-refresh-performance.test.ts` | PASS |
| SC32 | `test/task-2373-refresh-performance.test.ts` | PASS |
| SC33 | `test/task-2373-refresh-performance.test.ts`, `"SC33 and SC34: each completed timer tick rebuilds the authority projection"` | PASS |
| SC34 | `test/task-2373-refresh-performance.test.ts`, `"SC33 and SC34: each completed timer tick rebuilds the authority projection"` | PASS |
| SC35 | `test/task-2373-refresh-performance.test.ts`, `"SC35: a slow board refresh never overlaps or accumulates a timer backlog"` | PASS |
| SC36 | `test/task-2373-current-work-workflow.test.ts`, SC2–SC6 workflow tests | PASS |
| SC37 | `test/task-2373-needs-you.test.ts`, SC10–SC12 exhaustion tests | PASS |
| SC38 | `test/tui-headless-isolation.test.ts`, headless UI command tests | PASS |
| SC39 | `test/board-no-bypass.test.ts`, board projection/UI boundary tests | PASS |
| SC40 | `./scripts/verify-local.sh static-analysis` — terminal `ALL STAGES PASSED` | PASS |
| SC41 | `./scripts/verify-local.sh all` — terminal exit code 0 | PASS |

Next action: all declared checkpoints and required verification gates are committed and passed;
the mission is ready for Parallix lifecycle handoff.
