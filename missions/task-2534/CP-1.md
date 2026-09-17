# CP-1: Lock the bug (red)

## Summary

- Added `test/task-2534-stale-backlog-copy-landing-repro.test.ts`: an integration-tier
  reproduction that builds a throwaway git repo mirroring the `mission/task-2489` /
  `mission/task-2478` shape — `main` receives `backlog/completed/task-9001 - x.md`
  through a squash commit, while the mission branch's unsquashed history adds
  `backlog/tasks/task-9001 - x.md` (another mission's pre-squash commit) plus a
  genuinely new `backlog/tasks/task-9002 - new.md`. The test drives the real
  `squashAndLand` from `src/application/integrate/squash.ts` with real `git`
  (`spawnSync`) and stubs only the non-git landing collaborators.
- Registered the test as `integration-ci` in `test/lib/test-categories.ts` with the
  written boundary reason required by AGENTS.md ("Verification tiers").
- No `src/` change in this checkpoint, per the mission's CP-1 instruction.

The test's backlog port stub already passes `checkBacklogIntegrity` from
`src/adapters/backlog/task-file-io.ts`; CP-2 will add that method to
`IntegrateBacklogPort` and wire it in the CLI adapter, since `src/application/`
never imports `src/adapters/` directly in this codebase.

## Red failure line (current tree, before any `squash.ts` change)

`npx tsx --test test/task-2534-stale-backlog-copy-landing-repro.test.ts`

```
AssertionError [ERR_ASSERTION]: landed commit must not contain backlog/tasks/task-9001 - x.md
```

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 red reproduction of the stale copy landing | `test/task-2534-stale-backlog-copy-landing-repro.test.ts`, test name `TASK-2534: squash landing drops the stale task-9001 copy and keeps new task-9002`, run via `npx tsx --test test/task-2534-stale-backlog-copy-landing-repro.test.ts`; fails with `landed commit must not contain backlog/tasks/task-9001 - x.md` | RED (expected) |
| SC2 new task file still lands | Assertion `landed commit must contain backlog/tasks/task-9002 - new.md` in `test/task-2534-stale-backlog-copy-landing-repro.test.ts` | PENDING (blocked behind SC1 assertion) |
| SC3 landing log names the task id and canonical path | Assertion `an info line names task-9001 and backlog/completed/task-9001 - x.md` in `test/task-2534-stale-backlog-copy-landing-repro.test.ts` | PENDING |
| SC6 fixture mirrors `mission/task-2489` / `mission/task-2478` | `buildFixture()` in `test/task-2534-stale-backlog-copy-landing-repro.test.ts`: canonical file added on `main` by a squash commit, stale copy only in unsquashed branch history | PASS |
| Tier classification | `test/lib/test-categories.ts` entry `task-2534-stale-backlog-copy-landing-repro.test.ts` in `INTEGRATION_CI_TESTS`, checked by `test/test-categories.test.ts` (`npm test`) | PASS |

Next action: add the step-1 stale-path filter and the step-2 `checkBacklogIntegrity` fail-closed backstop in `squashAndLand`, extend `IntegrateBacklogPort`, and add the SC4 abort test.
