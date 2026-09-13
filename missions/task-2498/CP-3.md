# CP 3 — Defect 2 fixed (running-session attribution)

## Summary
Fixed defect 2 in `src/adapters/backlog/concrete-agent-read-adapter.ts`
`loadRunningSessions`. A live `px review --continue` session whose reconciled
current-work fact names a `null` agent was attributed to no family
(`parseAgentFamily(null) === null`, and a review session has `role: null` so
the session-marker path never applies), so it landed in the unattributed count
and every family reported `0`.

Change: when the reconciled current-work fact is in progress but names no
agent, attribute the session to the mission assignee family via
`loadAssignedAgent(session.missionId)` (falling through to the existing
marker/pinned-agent paths when the assignee does not resolve). Scoped strictly
to the null-agent bracket — non-null agents still attribute to the agent,
preserving SC5. `loadRunningSessions` now returns a `Promise.all` over the
per-session async resolution.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC3: null-agent review session attributes to assignee family | test `"a live null-agent review session attributes to the mission assignee family"` | PASS |
| SC4: per-family running count non-zero (session no longer unattributed) | reproduction test `ConcreteAgentReadAdapter.loadRunningSessions` returns `[{ missionId: 'task-2498', family: 'custom' }]` | PASS |
| SC5: non-null agent still attributes; live outranks stale marker | `test/task-2393-current-work-attribution-repro.test.ts` + test `"a live non-null agent session still attributes to that agent (SC5)"` | PASS |
| No regression in running-session detection | `test/running-sessions.test.ts` | PASS |

## Next action
CP 4: run `./scripts/verify-local.sh all` green; write the final Goal Check with durable evidence.
