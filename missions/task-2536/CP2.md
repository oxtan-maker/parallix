# CP 2 — Narrow launch-failure block persistence to positive availability/quota classification

## Summary
Narrowed `shouldPersistLaunchFailureBlock` in `src/adapters/agents/agents.ts`
(line ~254) so an ambiguous non-zero exit stays local to the failing launch.
The function now (1) returns `false` for any deterministic config/setup error
matched by `NON_BLOCKING_LAUNCH_ERROR_PATTERNS`, and (2) persists a family block
ONLY when `detectLimitHit` (already imported from
`src/application/services/agent-limit.ts`) returns a positive
availability/quota classification — `!!hit && !hit.reroute`.

Round-1 F2 resolution: the second block-persistence site (agents.ts L761-L777)
is retained as defence-in-depth only. Under default wiring it is unreachable —
startAgent's site-1 limit-hit check uses the same `detectLimitHit` classifier,
so a positive availability/quota classification is persisted at site 1 first.
A precise comment at the site-2 branch and the `failover-transient-failure-block`
domain-requirement row now state this; the genuine-quota block at site 1 is
untouched. The `shouldPersistLaunchFailureBlock` helper is still exercised
directly by the SIGKILL unit test (it returns `true` for a process-kill signal),
but through `startAgent` a SIGKILL is classified at site 1, not site 2.

A process-kill signal is still caught via `detectLimitHit`'s short-block path
(SIGKILL/SIGINT remain `true`), the qwen transient reroute still returns
`reroute: true` (so `shouldPersist` returns `false`), and per-agent reset-time
parsing is unchanged.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Ambiguous non-zero launch no longer writes a global block | `test/task-2536-ambiguous-launch-no-global-block.test.ts` green; `shouldPersistLaunchFailureBlock('codex', {status:1, stderr:'generic crash\n'})` returns `false` in `test/agents-limit-hit.test.ts` | PASS |
| Signal-kill blocks preserved | `test/agents-limit-hit.test.ts` `shouldPersistLaunchFailureBlock returns true for signal kills (SIGKILL)` (direct helper unit); through `startAgent` a SIGKILL is caught at site 1's `detectLimitHit` branch (task-2536 F2) | PASS |
| Deterministic config errors stay non-blocking | `test/agents-limit-hit.test.ts` (missing-session, unsupported CLI flags, home/bootstrap, OOM, …) all PASS | PASS |
| Fix localized to retry-path classifier; site-1 quota branch untouched | `src/adapters/agents/agents.ts` `shouldPersistLaunchFailureBlock` (line ~254); `detectLimitHit` branch at line ~657 unchanged | PASS |

## Next action
CP 3: confirm operator visibility of the failed launch is preserved — the
`agentErrors` record still captures `exitInfo`/`stderr`/`stdout`/`signal`/`status`
and the `status` board projection (`projectAgentAvailability` in
`src/application/projections/agent-status.ts`) still surfaces it via
`test/task-2368-agent-running-review-detection.test.ts`.
