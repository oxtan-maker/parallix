# CP-1: Failing reproduction test for TASK-2494

## Summary
Author the failing reproduction test that locks the bug before any fix. Created `test/task-2494-repro.test.ts` with four in-memory-fake-port tests:
1. Usage-blocked pinned implementer during rebase conflict names the usage block + reset time and never emits `forgejo`/`infrastructure`/`credential`/`does not substitute`.
2. Usage-blocked pinned implementer substitutes an eligible replacement family when policy permits.
3. Usage-block diagnostic classifies as non-`InfraBlocker`, non-`HumanOnly`, and `hasExplicitHumanOnlyDiagnostic` returns `false`.
4. Regression guard: a genuine infra failure mentioning token/network is still `InfraBlocker`/`HumanOnly` (must not widen the catch-all).

All four run red on the parent commit; the infra regression guard is the one assertion that is already green pre-fix.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Reproduction test locks the bug (red at parent) | `test/task-2494-repro.test.ts`, tests `"TASK-2494 repro: usage-block diagnostic classifies as a non-InfraBlocker, non-HumanOnly class"` etc. | PASS |
| Test runs via project runner | `npx tsx --test test/task-2494-repro.test.ts` (3 failing, 1 green at parent) | PASS |
| In-memory fakes only, no real Git/Forgejo/launcher | `test/task-2494-repro.test.ts` builds `RebaseWorkflowPort` fakes | PASS |

## Next action
CP-2: fix the rebase-handoff family fallback in `src/application/rebase-workflow.ts`.
