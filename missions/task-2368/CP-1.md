# CP-1: Failing reproduction of the undetected running review

## Summary

Added `test/task-2368-agent-running-review-detection.test.ts`, a fully mocked
board-facing reproduction of the reported board view: a review-lane mission
(`task-2274`) with a pending review round and a live agent session running its
review. The test drives the production read path `BoardProjectionBuilder.build()`
with stub `MissionReadAdapter`, `ReviewReadAdapter`, `GateReadAdapter`,
`AgentReadAdapter`, `GitReadAdapter`, and `OperationLogReadAdapter` — no Forgejo
call, no agent launch, no process table read.

Four scenarios:

1. running review session → the card must record the live session and the
   attention reason must be `none` (currently red);
2. no session → unchanged `review-lane` / `Awaiting review decision`
   (SC3 control, red only on the new `liveSession` field);
3. `loadRunningSessions()` returning `null` (liveness unknown) → unchanged
   `review-lane` attention, so unknown is never read as "an agent is on it";
4. `detectRunningMissionSessions` with a mocked `ps` line
   `node /repo/node_modules/.bin/px review task-2274` → the session is
   discovered and carries the mission id, proving the live-session record has
   the mission identity the board fails to use.

Observed red at the mission parent commit (`a38003efc`):

```
✖ a review-lane mission whose review is running does not ask for human attention
  AssertionError: the card records the live review session
  + undefined  - 'task-2274'
```

Scenarios 3 and 4 already pass, which localizes the defect: session discovery
works and yields the mission id; the board projection never attaches it to the
mission card.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 red reproduction exists before any production fix | `npx tsx --test test/task-2368-agent-running-review-detection.test.ts` at parent commit `a38003efc`, test `"a review-lane mission whose review is running does not ask for human attention"` fails with `the card records the live review session` | PASS |
| SC1 scenario models a live review session plus a pending review disposition | `test/task-2368-agent-running-review-detection.test.ts` helpers `pendingReview()` (round phase `reviewing`, `decision: null`) and `makeBuilder([{ missionId: reviewed, family: null }])` | PASS |
| SC2 asserts active review instead of human attention | Same test asserts `item.card.liveSession?.missionId === 'task-2274'` and `item.reason.kind === 'none'` | PENDING (red until CP-3) |
| SC3 no-session control is present | Test `"a review-lane mission with no live session still awaits a human review decision"` asserts `review-lane` / `Awaiting review decision`; plus `"unknown liveness leaves the review-lane attention item unchanged"` | PASS (assertions authored; `liveSession` field lands in CP-3) |
| SC4 no real Forgejo, agent, or heavy CLI | `test/task-2368-agent-running-review-detection.test.ts` uses only in-file adapter stubs and the `listProcesses` / `listWorktrees` / `resolveCwd` / `now` seams of `src/adapters/agents/running-sessions.ts` | PASS |
| SC5 focused test command runs | `node --test test/task-2368-agent-running-review-detection.test.ts` (run via `npx tsx --test` for TypeScript, as `test/run-default-tests.ts` does) | PENDING (green expected after CP-3) |
| SC6 full gate | `./scripts/verify-local.sh all` | PENDING (CP-4) |

Next action: CP-2 — document the handoff from `detectRunningMissionSessions` through `ConcreteAgentReadAdapter.loadRunningSessions()` to `BoardProjectionBuilder.build()` and `attentionReason`, naming the smallest boundary that drops the mission-level running-review signal.
