# CP-1: Extract report rendering to stats-report.ts

Extracted 4 renderers into `stats-report.ts` (251 lines). All re-exported from `stats.ts`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: stats-report.ts contains renderers | `src/adapters/cli/commands/stats-report.ts:30` (formatStatsTable), `:49` (renderWeeklyStatsReport), `:110` (renderRangeStatsReport), `:144` (renderMissionPhaseReport) | PASS |
| SC2: stats.ts re-exports symbols | `src/adapters/cli/commands/stats.ts:2285` (ESM), `:2314-2326` (CJS) | PASS |
| SC3: stats.ts delegates to stats-report.ts | `src/adapters/cli/commands/stats.ts:1162` | PASS |
| SC4: test/stats.test.ts render tests pass | `test/stats.test.ts` — 7/7 pass | PASS |
| SC5: test/mission-phase-stats.test.ts passes | `test/mission-phase-stats.test.ts` — 12/12 pass | PASS |
| SC6: Focused tests exercise all 4 renderers | `test/stats-report.test.ts` — 9/9 pass | PASS |
| SC7: Static analysis clean | `./scripts/verify-local.sh static-analysis` | PASS |
| SC8: Diff within 250-500 | `git diff --numstat e420c5e0..HEAD` — see F2 pushback | DOCUMENTED |

## Next action

Verify gates pass, hand off to review.
