# CP-1: Diagnosis and Fix for task-1415

## Goal Check

| # | Goal | Status | Evidence |
|---|------|--------|----------|
| 1 | Reproduce the weekly-mission-count staleness bug on the actual integration path | ✅ PASS | `test/task-1415-closed-mission-counts.test.js:63` (`task-1415: recordPostIntegrationStats counts a closed mission in the current week even when the base worktree tip commit is stale`) calls the real, unmocked `recordPostIntegrationStats` (`lib/commands/integrate.ts:1417`) against a real git repo whose tip commit is stamped with a stale committer date via `GIT_COMMITTER_DATE` (`test/task-1415-closed-mission-counts.test.js:88`-`102`), simulating the Variant A fast-forward closeout. Confirmed red on the pre-fix tree: `git stash push -- lib/commands/integrate.ts test/integrate.test.js && npm run build:cjs && node --test test/task-1415-closed-mission-counts.test.js` → `AssertionError: the closed row must not be stamped with the stale base-worktree committer date, actual: '2026-06-13'`. Confirmed green after `git stash pop && npm run build:cjs && node --test test/task-1415-closed-mission-counts.test.js` → 1/1 pass. |
| 2 | Root-cause `summarizeMissionWindow`, `summarizeAgentWindow`, `rowInWindow`, `canonicalizeStatsRow`, `upsertStatsRow`, and their callers | ✅ PASS | `lib/commands/stats.ts:755` (`summarizeMissionWindow`) filters to `closed: 'yes'` rows (task-1380, unmodified). `lib/commands/stats.ts:818` (`summarizeAgentWindow`) intentionally omits the `closed` filter (task-1409) but its per-mission dedup at `lib/commands/stats.ts:848`-`865` (`byMission`, keyed only on `statsMissionKey`) already collapses every stage row for a mission to one winner. `lib/commands/stats.ts:745` (`rowInWindow`) is inclusive on both boundaries (`date >= window.start && date <= window.end`); `lib/commands/stats.ts:735` (`buildWeeklyWindows`) has no gap/overlap between windows. `lib/commands/stats.ts:1618` (`upsertStatsRow`)'s dedup key at line 1631-1636 includes `stage`, so the integration row never collides with an earlier stage row. The actual defect was `lib/commands/integrate.ts:1425` (pre-fix), the caller — see "Root cause" below. |
| 3 | Fix the bug | ✅ PASS | `lib/commands/integrate.ts:1417`-`1435` (`recordPostIntegrationStats`) no longer derives the closed row's `date` from `git log -1 --format=%cs`; it omits `date` entirely, letting `lib/commands/stats.ts:1649` (`recordIntegrationStats`'s own default, `formatDateOnly(new Date())`) apply — the same default `lib/commands/stats.ts:1784` (`recordStageStats`) already uses. |
| 4 | All existing tests pass, zero regressions | ✅ PASS | `node --test test/task-1415-closed-mission-counts.test.js test/stats-task-1380-closed-filter.test.js test/integrate.test.js` → 67/67 pass. Full single-process `npm test` result below (see Verification). |
| 5 | Static analysis gates pass | ✅ PASS | `bash scripts/verify-local.sh static-analysis` → `PASS: ESLint clean`, `PASS: tsc typecheck clean`, `PASS: test-hygiene clean`. |

## Root cause

`lib/commands/stats.ts` was already correct on `main` (confirmed across two rounds of investigation):
- `summarizeMissionWindow` (stats.ts:755) filters to `closed: 'yes'` rows before counting (task-1380).
- `summarizeAgentWindow` (stats.ts:818) intentionally does *not* filter by `closed` (task-1409, by design); its per-mission dedup (`byMission`, keyed only on `statsMissionKey`) already collapses every stage row for a mission down to a single winning row, so multiple stage rows cannot inflate agent counts either.
- `rowInWindow` is inclusive on both boundaries; `buildWeeklyWindows` has no gap or overlap.
- `upsertStatsRow`'s dedup key includes `stage`, so an integration row (`stage: 'default'`, `closed: 'yes'`) never collides with an earlier stage row.

The actual defect was in `lib/commands/integrate.ts` (`recordPostIntegrationStats`, previously ~line 1425): it derived the closed row's `date` from `git log -1 --format=%cs` on the base worktree, run *after* integration completes.

In "Variant A" (PR already merged on Forgejo before `px integrate` runs — `useVariantA = context.pr.merged`), `finalizeVariantACloseout` only creates a new commit when there is a staged diff after `git add -A`. When there isn't, it returns `{ ok: true, changed: false }` with no new commit. In that path, `git log -1` on the base worktree returns whatever committer date the branch tip already carried — the mission's original, possibly days-old commit date, not the day the mission was actually closed. The resulting `closed: 'yes'` row was written with that stale date, landing it outside both the current and previous week's windows even though closure happened "today" — exactly the reported symptom (row count 703 → 708, weekly mission counts 45/49 unchanged).

## Fix

`lib/commands/integrate.ts` `recordPostIntegrationStats`:
- Removed the `gitRunner`-based date derivation (`git log -1 --format=%cs`) and its error path entirely.
- Stopped passing a `date` field to `recordIntegrationStatsFn`, so `stats.recordIntegrationStats` uses its own existing default of `formatDateOnly(new Date())` — the same default `recordStageStats`/`recordActiveStats` already use for every other stats-writing call site.
- Removed the now-unused `gitRunner` option from the function signature and its JSDoc.

`test/integrate.test.js`: updated the five existing `recordPostIntegrationStats` unit tests to stop mocking `gitRunner`/asserting on a git-derived `date` (one assertion now explicitly checks `date` is `undefined` in the options passed to `recordIntegrationStatsFn`, documenting the intentional omission).

## Scope note

This mission's Restricted Areas state "Do not modify `lib/commands/integrate.ts`." Round 1 honored that literally and parked the fix as TASK-1421 per the mission's own Stop Rule ("escalate to the mission reviewer for scope decision"). The round-2 reviewer explicitly rejected that outcome, stating the mission cannot be approved without changing the production path that controls the stale count. Per the Stop Rule's own design — escalating to the reviewer *is* the scope-decision mechanism — this round implements the fix in `integrate.ts`, scoped to exactly the one function responsible (`recordPostIntegrationStats`'s date derivation), with matching test updates. TASK-1421 is left open/closed at the reviewer's discretion; the description there is now historical context rather than an open defect.

## Verification

```
$ node --test test/task-1415-closed-mission-counts.test.js
# fails red before the fix (stash lib/commands/integrate.ts + test/integrate.test.js, rebuild, run):
#   AssertionError: the closed row must not be stamped with the stale base-worktree committer date
#   actual: '2026-06-13', expected: not '2026-06-13'
# passes green after the fix (stash pop, rebuild, run): 1/1 pass

$ node --test test/task-1415-closed-mission-counts.test.js test/stats-task-1380-closed-filter.test.js test/integrate.test.js
# 67/67 pass

$ bash scripts/verify-local.sh static-analysis
# ESLint, tsc, test-hygiene: all PASS

$ bash scripts/verify-local.sh all
# tests 2021, pass 1999, fail 0 (all green)
```

## Files Changed

| File | Change |
|------|--------|
| `lib/commands/integrate.ts` | `recordPostIntegrationStats` no longer derives `date` from `git log -1 --format=%cs`; omits `date`, letting `recordIntegrationStats` default to today |
| `test/integrate.test.js` | Updated 5 `recordPostIntegrationStats` tests to drop the `gitRunner` mock / git-derived-date assertions |
| `test/task-1415-closed-mission-counts.test.js` | Rewritten as a real, unmocked, red-to-green reproduction against the actual integration path |
| `missions/task-1415/CP-1.md` | This document |
