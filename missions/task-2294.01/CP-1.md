# CP-1 — Reproduction test for implementer-owned conflict resolution

## Summary

Authored `test/task-2294.01-repro.test.ts`, a hermetic red-to-green reproduction
test covering both conflict entry points:

1. **`px resolve-conflict`** — drives `resolveConflict` with a stubbed conflict
   classification (mission-specific files only) and a spy `startAgentFn`, then
   asserts the launch options carry `agent: 'codex'` (the recorded implementer),
   `slug`, and `role: 'implementer'`.
2. **`px rebase` shared-file conflict path** — drives `RebaseCommandUseCase`
   through a fully mocked `RebaseWorkflowPort` whose `getTaskImplementer`
   returns `codex`, forces a shared-file conflict, and asserts the same three
   options on the `conflict-resolution` launch.

No real agent, git, Forgejo, or filesystem access: every seam is a double, and
the port double returns `pool-selected` when no `agent` is pinned so the failure
mode is visible in the assertion diff.

Observed red on this parent tree (`npx tsx --test test/task-2294.01-repro.test.ts`):
both tests fail with `actual: undefined, expected: 'codex'` on the pinned-agent
assertion — the conflict launches at `src/application/rebase-workflow.ts:820`
and `src/adapters/cli/commands/resolve-conflict.ts:96` pass only `prompt` and
`worktree`, so `startAgent` falls through to pool selection.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC10: reproduction test exists at the mission-declared path | `test/task-2294.01-repro.test.ts` | PASS |
| SC10: test is red on the parent commit | `npx tsx --test test/task-2294.01-repro.test.ts` fails with `actual: undefined, expected: 'codex'` at `test/task-2294.01-repro.test.ts:77` and `test/task-2294.01-repro.test.ts:155` | PASS (red as required) |
| SC1 covered by a failing assertion (resolve-conflict pins implementer) | `"TASK-2294.01 repro: px resolve-conflict pins the mission implementer as the conflict agent"` | PASS |
| SC2 covered by a failing assertion (rebase shared-file path pins implementer) | `"TASK-2294.01 repro: px rebase shared-file conflict path pins the mission implementer"` | PASS |
| SC7 covered: `slug` + `role: "implementer"` asserted on both launches | `test/task-2294.01-repro.test.ts:79`, `test/task-2294.01-repro.test.ts:157` | PASS |
| AC #6: hermetic — no real agent/Forgejo/git | port doubles only, `test/task-2294.01-repro.test.ts:88` (`git` double) and `test/task-2294.01-repro.test.ts:111` (`startAgent` double) | PASS |
| Bug source located for both entry points | `src/adapters/cli/commands/resolve-conflict.ts:96`, `src/application/rebase-workflow.ts:820` | PASS |

Next action: CP-2 — add `resolveTaskFileFn`/`getTaskImplementerFn`/`rootDir` seams to `src/adapters/cli/commands/resolve-conflict.ts`, resolve the implementer, pass `agent`/`slug`/`role: 'implementer'` to `startAgent`, and add the `pinnedAgent` explicit-fail option to `src/adapters/agents/agents.ts` so an unavailable implementer never reroutes to pool selection.
