# CP-1: Web agent activity

## Summary

The web board now requires both a fresh named agent-work fact and a live `px` session before it blinks or names an active worker. Integration and handoff publish progress without naming the previous implementer. `AGENTS.md` and the mission contract were shortened to current, testable instructions.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Deterministic integration shows progress without agent activity | `test/task-2576-agent-activity-repro.test.ts:28`, "TASK-2576: deterministic integration work is progress, not running-agent activity" | PASS |
| Fresh named agent work with a live session identifies the worker | `web/src/format.ts:79`, `web/src/flight-column.tsx:67`, "TASK-2576: deterministic integration work is progress, not running-agent activity" | PASS |
| Stale work does not blink | `web/src/format.ts:82`, "TASK-2453 SC2/SC4: web session activity stays separate from Ink work freshness" | PASS |
| Handoff does not publish a finished implementer as the active worker | `src/application/execute-mission-service.ts:108`, `src/application/controller/board-controller.ts:221`, "an automatic family handoff updates the same mission current work and creates no second identity" | PASS |
| Final verification passed | `./scripts/verify-local.sh all` (3,040 passed, 0 failed), `./scripts/verify-local.sh static-analysis`, `./scripts/verify-local.sh docs` | PASS |

The process scan observes a live `px` command, not its agent child. A published agent-work fact can briefly outlive that child before the coordinator publishes its next state. Exact child liveness would require tracking the launched process identity.

Next action: integrate the mission after review.
