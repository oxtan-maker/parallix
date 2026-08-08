# Mission: Extract stats report rendering (task-2217)

## Goal
Extract 4 report renderers from `stats.ts` into `stats-report.ts`. Preserve output and public exports.

## Scope
- Extract: `formatStatsTable`, `renderWeeklyStatsReport`, `renderRangeStatsReport`, `renderMissionPhaseReport`
- Re-export all from `stats.ts` (ESM + CJS)
- Focused tests in `test/stats-report.test.ts`
- Final diff: 250-500 added+deleted lines (excluding `graphify-out/`)

## Success Criteria
- SC1: `stats-report.ts` contains extracted renderers
- SC2: `stats.ts` re-exports all extracted symbols
- SC3: `stats.ts` delegates rendering to `stats-report.ts`
- SC4: `test/stats.test.ts` render tests pass
- SC5: `test/mission-phase-stats.test.ts` passes
- SC6: `test/stats-report.test.ts` exercises all 4 renderers
- SC7: `./scripts/verify-local.sh static-analysis` clean
- SC8: `git diff --numstat` total added+deleted is 250-500

## Gates
- `./scripts/verify-local.sh static-analysis`
- `npm test -- test/stats.test.ts test/mission-phase-stats.test.ts test/stats-report.test.ts`

## Restricted Areas
- `stats-backfill.ts`, `stats-backfill-service.ts`, CSV I/O, historical inference, CLI dispatch, telemetry
