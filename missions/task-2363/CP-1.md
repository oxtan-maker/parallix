# CP-1 — Baseline regressions

## Summary

Recorded the baseline tree and authored the failing regressions that prove each
defect this mission closes. No production code was changed in this checkpoint.

Baseline record:

- `git rev-parse HEAD` → `78e2d507be6fa8c647d448cdb93c383dbcd8fc1a`
- `git status --short` → clean (no output)

New test assets:

- `test/fixtures/task-2363-decision-window-fixture.ts` — the contaminated-history
  fixture: 240 completed missions from May with cycle times in 800–1200 min, 28
  completed in the previous window (2026-07-29 → 2026-08-04) and 31 completed in
  the current window (2026-08-05 → 2026-08-11). Every expected value is stated as
  a literal beside the arithmetic that produces it; no production median, window,
  or cohort helper derives an expectation.
- `test/task-2363-weekly-decision-window.test.ts` — windowing regressions.
- `test/task-2363-repository-identity.test.ts` — repository-identity regressions.

Observed baseline failures (`npx tsx --test test/task-2363-weekly-decision-window.test.ts
test/task-2363-repository-identity.test.ts`): 9 fail, 1 pass.

| Baseline claim | Observed on `78e2d50` |
|---|---|
| FLOW cycle-time `n` includes historical missions | `observationCount` 299, expected 31 |
| Historical extreme cycle times change the displayed current median | median 890 min, expected 40 min |
| Agent runtime aggregates all history | `observationCount` 279, expected 11 |
| Lane dwell aggregates all history | active-lane `observationCount` 1052, expected 36 |
| Review bounce aggregates all history | `observationCount` 299, expected 31 |
| Current/previous decision windows unavailable in FLOW | `metrics.decisionWindow` is `undefined` |
| Product/repository identity divergence exists | `resolveStatsRepoName` returns `deliberately-different-display-name` where the canonical id is `actual-repository-name` |
| Current-state lane age must stay unwindowed | already correct on baseline — the one passing test |

Already fixed on the baseline tree, so left alone per the mission's
"do not manufacture a failure" rule:

- **Unknown `reviewFixRounds` → zero.** TASK-2357 defect C already proves SQL NULL
  survives producer → SQLite → read → `MissionOutcome` → cohort. Source evidence:
  `src/adapters/cli/commands/stats.ts` `canonicalizeStatsRow` skips
  `pr_fix_rounds` when undefined; `src/adapters/sqlite/usage-repository.ts` maps
  SQL NULL to `undefined`; `src/application/projections/metrics-read-adapter.ts`
  maps it to `null`. Test evidence:
  `test/task-2357.c-unknown-review-fix-rounds.test.ts`.
- **Worktree path used as repository identity.** Closed by TASK-2357 defect B —
  `test/task-2357.b-canonical-repository-identity.test.ts`. The remaining and
  still-open half is the configured `product.name` alias, covered by the new
  `test/task-2363-repository-identity.test.ts`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Baseline commit and worktree state recorded | `git rev-parse HEAD` = `78e2d507be6fa8c647d448cdb93c383dbcd8fc1a`; `git status --short` empty | PASS |
| FLOW cycle-time `n` includes historical missions | `"reports the current-window cycle-time population, not all history"` in `test/task-2363-weekly-decision-window.test.ts` fails with actual 299 | PASS |
| Historical extreme cycle times move the current median | `"keeps extreme historical cycle times out of the current median"` fails with actual 890 | PASS |
| Current/previous decision windows unavailable in FLOW | `"exposes the current and previous decision windows with their dates"` fails: `metrics.decisionWindow` undefined | PASS |
| Unknown `reviewFixRounds` already preserved | `test/task-2357.c-unknown-review-fix-rounds.test.ts` passes on baseline (`npx tsx --test test/task-2357.c-unknown-review-fix-rounds.test.ts`) | PASS (pre-existing) |
| Product/repository identity divergence exists | `"writes new measurement rows under the canonical repository id, not product.name"` in `test/task-2363-repository-identity.test.ts` fails | PASS |
| Contaminated-history fixture with 240+ old missions exists | `test/fixtures/task-2363-decision-window-fixture.ts`, `OLD_HISTORY_COUNT = 240` | PASS |
| Operational lane-age metric must stay unwindowed | `"keeps current-state lane age unwindowed"` already passes on baseline | PASS |

Next action: CP-2 — extract `weeklyDecisionWindows` (current `today-6 → today`, previous `today-13 → today-7`) from `buildWeeklyWindows` in `src/adapters/cli/commands/stats.ts` into `src/application/services/decision-window.ts`, and make both `stats-command-use-case.ts` and the CLI adapter consume it without changing `px stats` weekly output.
