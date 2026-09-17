# CP 3 — Operator visibility of the failed launch is preserved

## Summary
Confirmed the failed launch stays visible to the operator. The launch-failure
path in `src/adapters/agents/agents.ts` still records the diagnostic on the
`agentErrors` map before retrying:

    agentErrors.set(chosen, { exitInfo, stderr, stdout, signal, status })

This block is untouched by the task-2536 fix (the fix only narrows
`shouldPersistLaunchFailureBlock`), so the failed launch's reason and
exit/signal info survive. The `status` board projection still renders a
family's state via `projectAgentAvailability` in
`src/application/projections/agent-status.ts` (`reason`/`limit`/`runningSessions`),
and an ambiguous launch now correctly produces no block row to render.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Failed-launch diagnostic still captured | `agentErrors.set` captures `exitInfo`/`stderr`/`stdout`/`signal`/`status` in `src/adapters/agents/agents.ts` (~L745), unchanged by the fix | PASS |
| Board projection surfaces family state | `projectAgentAvailability` in `src/application/projections/agent-status.ts`; `test/board-readers.test.ts` PASS | PASS |
| Agent-running / review detection unaffected | `test/task-2368-agent-running-review-detection.test.ts` 4/4 PASS | PASS |

## Next action
CP 4: confirm genuine usage-limit and confirmed provider-wide outage blocks still
persist and reroute, and that the qwen transient reroute and SIGINT short-block
path remain intact.
