# CP-2 — Implementer pinning in `px resolve-conflict`

## Summary

**`startAgent` gained one opt-in explicit-fail branch.** `pinnedAgent?: boolean`
(`src/adapters/agents/agents.ts:75`) marks a launch whose actor is owned
outright. A single guard, `refuseFallbackWhenPinned`
(`src/adapters/agents/agents.ts:304`), is called at every existing reroute point
before `chosen` is cleared — blocked family, `LAUNCHER_UNAVAILABLE`, saturated
custom capacity, usage-limit hit, and `ENOENT`/`EACCES` spawn failure — and
throws `PinnedAgentUnavailableError` (`src/adapters/agents/agents.ts:79`,
exported at `src/adapters/agents/agents.ts:664`) naming the family and the
concrete detail. The launch-failure branch instead returns the pinned agent's
own failed result (`src/adapters/agents/agents.ts:584`) so the caller keeps
reporting the owner's exit status rather than substituting a family. Behavior
without `pinnedAgent` is untouched: overrides still get their one fallback retry.

**`px resolve-conflict` now resolves and pins the mission implementer.** New
seams `resolveTaskFileFn` / `getTaskImplementerFn` / `rootDir`
(`src/adapters/cli/commands/resolve-conflict.ts:56`) read the recorded
implementer from the task file through the backlog adapter. A missing
implementer is a hard stop with recovery guidance
(`src/adapters/cli/commands/resolve-conflict.ts:110`); otherwise the launch
carries `agent: implementer`, `slug`, `role: 'implementer'`, and
`pinnedAgent: true` (`src/adapters/cli/commands/resolve-conflict.ts:132`), and a
`PinnedAgentUnavailableError` is caught and reported as a non-zero exit naming
the family and launcher detail (`src/adapters/cli/commands/resolve-conflict.ts:138`).

No family name is hardcoded on the conflict path: whatever family the task file
records is passed through, so configured future families work unchanged.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: `px resolve-conflict` resolves the implementer and passes it as `agent` | `src/adapters/cli/commands/resolve-conflict.ts:132`; `"resolveConflict pins the recorded mission implementer as the conflict agent"` | PASS |
| SC4: unavailable pinned launcher exits non-zero naming family + launcher detail | `src/adapters/cli/commands/resolve-conflict.ts:138`; `"resolveConflict exits non-zero and names the implementer when its launcher is unavailable"` | PASS |
| SC6: missing implementer exits non-zero and never launches an agent | `src/adapters/cli/commands/resolve-conflict.ts:110`; `"resolveConflict exits non-zero when the mission has no recorded implementer"` | PASS |
| SC7: launch carries `slug` and `role: "implementer"` on the `conflict-resolution` step | `src/adapters/cli/commands/resolve-conflict.ts:134`; `"resolveConflict pins the recorded mission implementer as the conflict agent"` | PASS |
| AC #3: pinned family is not silently replaced after block / capacity / limit / spawn failure | `src/adapters/agents/agents.ts:304`; `"startAgent with pinnedAgent fails instead of rerouting when the agent is blocked"`, `"startAgent with pinnedAgent returns the pinned agent failure instead of retrying another family"` | PASS |
| AC #4: any configured family accepted, no built-in names on the conflict path | `"resolveConflict accepts any configured implementer family without hardcoding names"` (asserts `claude`, `codex`, `custom`, `vibe`, `future-family`) | PASS |
| Non-pinned callers keep their existing one-retry fallback | `"startAgent without pinnedAgent keeps rerouting a pinned-by-override agent"` | PASS |
| SC10 (partial): repro test's resolve-conflict half now green | `npx tsx --test test/task-2294.01-repro.test.ts` — `"TASK-2294.01 repro: px resolve-conflict pins the mission implementer as the conflict agent"` passes; the rebase half is still red pending CP-3 | PASS |
| Suites green | `npm test -- test/resolve-conflict.test.ts` (23/23 pass), `npm test -- test/agents.test.ts` (100 pass, 0 fail) | PASS |
| Static analysis clean on changed files | `npx tsc --noEmit` exits 0 | PASS |

Next action: CP-3 — resolve the implementer via `port.resolveTaskFile` / `port.getTaskImplementer` before the shared-file conflict launch at `src/application/rebase-workflow.ts:820`, pass `agent`/`slug`/`role`/`pinnedAgent`, and turn the second repro assertion green.
