# CP-1: Failing reproduction of implementer loss during rebase

## Summary

Added `test/task-2503-repro.test.ts`, a unit-level reproduction that drives
`RebaseCommandUseCase` through a fully mocked `RebaseWorkflowPort` (no git,
Forgejo, agent, backlog, or filesystem access).

- Test 1 records implementer A (`claude`) in the mission's review state — the
  mission record that lives outside the replayed Git history — while the
  Backlog task file exposes the stale/replayed assignee B (`qwen` before
  replay, `vibe` after). The rebase pauses on a shared-file conflict, so the run
  reaches agent-assisted recovery, and the test asserts the conflict-resolution
  launch carries implementer A. This assertion is **red** at the mission parent
  commit: recovery launches `qwen`, the replayed task metadata.
- Test 2 removes both local metadata sources (no review state, task file
  unresolvable) and asserts the failure is reported as a local workflow
  condition — the "No recorded implementer …" diagnostic with the assignee
  remediation — and that the output never mentions Forgejo, network, or
  connection failure. This one passes today and locks the classification in.

No production behaviour changed in this checkpoint.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Regression test starts a rebase with recorded implementer A, exposes replayed implementer B, and fails at the mission parent commit | `test/task-2503-repro.test.ts`, test name "shared-file rebase recovery dispatches the implementer recorded before commit replay"; `npx tsx --test test/task-2503-repro.test.ts` reports `'qwen' !== 'claude'` | Red as required |
| Shared-file conflict recovery dispatches recorded implementer A; test passes after the fix | Same test name in `test/task-2503-repro.test.ts` asserts `options.agent === 'claude'`, `role === 'implementer'`, `pinnedAgent === true` | Pending CP-2 |
| Local metadata unavailability is a local workflow condition with no Forgejo/network attribution | Test name "unavailable local mission metadata is reported as a local workflow condition, not an infrastructure blocker" in `test/task-2503-repro.test.ts` (`assert.doesNotMatch(output, /forgejo\|network\|unreachable\|connection refused/i`) | Passing |
| `./scripts/verify-local.sh all` exits successfully | Deferred to CP-3 (repository gate) | Pending CP-3 |

Next action: capture the mission's recorded implementer from the pre-replay
mission record in `src/application/rebase-workflow.ts` and route shared-file
conflict recovery through it, turning test 1 green (CP-2).
