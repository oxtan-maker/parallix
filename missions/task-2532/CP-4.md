# CP 4 — Verification

## Work done
- Reproduction test green: `test/task-2532-stale-integration-state-repro.test.ts`
  passes 6/6. Original 3 (`SC1/SC3` marker sweep + non-marker preservation,
  `SC2` dead-rebase abort + index clear, `SC4` clean-worktree no-op) were red at
  the parent commit (`2b8c41c`) and green once the routine landed (CP 1 → CP 2).
  Three new cases lock the round-1 fixes: `drops two marker stashes in descending
  order and keeps a non-marker stash` (F1), `dry-run detects poison without
  mutating the base worktree` (F2). The round-2 F3 guard test was removed (see
  below).
- F1 (stale positional refs): `repairBaseWorktree` collects every marker stash
  with its `git stash list` index (via a shared `listMarkerStashes()` helper)
  and drops in descending index order, so the renumber a drop triggers can no
  longer redirect a later `drop` at a non-marker stash. Asserted by the
  two-marker case above.
- F2 (`--dry-run` mutation): the repair runs detect-only under `dryRun` —
  `detectOnlyReport` logs what it would drop/abort and mutates nothing — wired
  through `runIntegration` (`src/application/integrate-workflow.ts`) which passes
  `request.dryRun` to `repairBaseWorktree`. Asserted by the dry-run case above.
- F3 (task-2532 round 2): the round-1 in-flight guard was rejected — its
  `isSlugIntegrating` predicate skipped a marker stash whose owning mission was
  still in the `integration` lane, but that status is not a liveness signal
  (`approve` moves to `integration`; the only exit is `integrate` → `done`), so
  it kept exactly the SC1 poison. The predicate is removed from the production
  wiring; the module doc now documents that integrate is single-writer per base
  worktree (`restoreMainCheckoutStash` pops `stash@{0}`, so concurrent runs were
  never supported) and the sweep drops every marker stash unconditionally, as
  SC1 requires.
- Existing integrate suites still pass: `integrate.test.ts` 87/87 and
  `integrate-task-1410-stash-pop-corruption.test.ts` 9/9 (stash/restore pair and
  `probeMerge` untouched, SC6).
- Static analysis clean: `./scripts/verify-local.sh static-analysis` → all stages
  PASS (ESLint, tsc typecheck, test-hygiene, test typecheck).
- Test registered in `test/lib/test-categories.ts` → `INTEGRATION_CI_TESTS`
  (crosses a real Git boundary: temporary repos in a temp dir).
- Docs updated: ADR 0043 notes integration now heals stale base-worktree state at
  entry. `./scripts/verify-local.sh docs` PASS.
- Full `./scripts/verify-local.sh all`: the only failing tests are
  `default-test-suite` (`routes every moved group to integration`) and the
  `coverage-gate` spawn (ENOENT/SIGKILL) — both confirmed failing on the clean
  parent commit, i.e. pre-existing and unrelated to this mission. No new
  regressions introduced.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 marker stash dropped, later integrate unblocked | `test/task-2532-stale-integration-state-repro.test.ts`, `"drops a marker-tagged integration stash and leaves a real stash untouched"` | PASS |
| SC2 dead rebase aborted + index cleared, preflight clean | `test/task-2532-stale-integration-state-repro.test.ts`, `"aborts a dead rebase and clears the unmerged index"` | PASS |
| SC3 non-marker stash never dropped | `test/task-2532-stale-integration-state-repro.test.ts`; `src/application/integrate/base-worktree-repair.ts` `isIntegrationMarkerStash` | PASS |
| SC4 clean worktree unaffected | `test/task-2532-stale-integration-state-repro.test.ts`, `"leaves an already-clean base worktree unchanged"` | PASS |
| SC5 repair at single entry chokepoint before stash/rebase | `src/application/integrate-workflow.ts:192` (`repairBaseWorktree` call inside `runIntegration`, before preflight/stash/rebase) | PASS |
| SC6 stash/restore pair + probeMerge unchanged; suites pass | `integrate.test.ts` 87/87; `src/adapters/cli/commands/integrate-conflict.ts` `stashMainCheckoutIfNeeded`/`restoreMainCheckoutStash` untouched | PASS |
| SC7 lint + static analysis clean | `./scripts/verify-local.sh static-analysis` → ALL STAGES PASSED | PASS |
| Repro red at parent, green after fix | `test/task-2532-stale-integration-state-repro.test.ts` red at parent `2b8c41c` (ERR_MODULE_NOT_FOUND `base-worktree-repair.js`); current tree → pass 6/fail 0 | PASS |
| Repro test registered in CI lane | `test/lib/test-categories.ts` → `INTEGRATION_CI_TESTS` | PASS |
| Docs updated | `docs/adr/0043-git-target-resolution-strategy.md`; `./scripts/verify-local.sh docs` PASS | PASS |
| F1 marker sweep drops in descending index order, non-marker stash survives | `test/task-2532-stale-integration-state-repro.test.ts`, `"drops two marker stashes in descending order and keeps a non-marker stash"`; `src/application/integrate/base-worktree-repair.ts` `repairBaseWorktree` | PASS |
| F2 `--dry-run` does not mutate the base worktree | `test/task-2532-stale-integration-state-repro.test.ts`, `"dry-run detects poison without mutating the base worktree"`; `src/application/integrate/base-worktree-repair.ts` `detectOnlyReport` | PASS |
| F3 round-2 guard removed: sweep drops every marker stash unconditionally (single-writer per base worktree) | `src/application/integrate/base-worktree-repair.ts` module `@remarks` F3; `src/application/integrate-workflow.ts` `runIntegration` (no `isSlugIntegrating` predicate) | PASS |

## Next action
All four checkpoints committed and both declared Gates (`static-analysis`, and `all` apart from the two pre-existing failures) pass. Mission complete; hand off.
