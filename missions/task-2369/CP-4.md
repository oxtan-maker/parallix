# CP-4 — Parts D + E: unknown review-fix rounds stay unknown

## Summary

Closed every remaining place where an unknown review-fix count became a measured
zero, along the live writer/read/report path.

**`src/adapters/cli/commands/stats.ts`**

- `defaultPrFixRounds()` returns `undefined`, not `'0'`, when the caller supplies
  no count and no prior **known** count exists. NULL rows are now filtered out
  before taking the prior maximum, so `[NULL, NULL]` is unknown, `[NULL, 0]` is a
  known zero, and `[NULL, 2]` is a known 2. A store read failure returns
  `undefined` as well — a failed read is not evidence of zero rounds.
- `defaultPrFixRounds()` now receives the caller's `store`/`dbPath`, so
  `recordActiveStats()` / `recordReviewStats()` read the same measurement port
  the row is about to be written through instead of the ambient database.
- `measurementToStatsRow()` maps a NULL `pr_fix_rounds` to `undefined` via a
  dedicated `nullableNumeric()`; every other column keeps the historical `'0'`
  default, so no other metric's semantics move.
- `deriveImplementerAndFixRounds()`'s `unknown-fallback` branch returns
  `prFixRounds: null` instead of `0`, so `recordIntegrationStats()` cannot write
  a manufactured zero into the integration rollup row.

**`src/application/projections/metrics-read-adapter.ts`**

- Aggregating several measurement rows for one mission no longer folds a NULL
  into the maximum. `Math.max(existing ?? -1, null)` evaluated to `0`, so two
  unknown rows for one mission became a measured zero. NULL rows now carry no
  observation.

Already correct at baseline, verified and left untouched (mission stop rule):
`normalizeStatsRow()` (NULL/undefined to `undefined`), `canonicalizeStatsRow()`
(skips the generic `USAGE_NUMBERS` default for an unknown `pr_fix_rounds`),
`statsRowToMeasurement()` (`undefined` to SQL NULL), `recordStageStats()` and
`accumulateStageStats()` (default `prFixRounds` to `undefined`), and the cohort
projection in `src/application/projections/cohorts.ts` (already filters
`reviewFixRounds !== null`).

One line-number citation in `src/application/consumer-domain-requirements.ts`
(`usage-mission-key`) was updated to follow `statsMissionKey` after the edits
shifted `stats.ts`; that guard is asserted by
`test/domain-consumer-requirements.test.ts`.

**Mutation sensitivity (recorded, not committed).** Restoring `unknown -> '0'` in
both `defaultPrFixRounds()` and `measurementToStatsRow()` turned all three
review-fix regressions red (R5 `'0' !== undefined`, R5 carry-forward, R6
`observationCounts.reviewFixRounds 4 !== 2`) while R1–R4 stayed green. Correct
code restored.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC05/AC17/AC18 unknown stays unknown through the live writers | `test/task-2369-regressions.test.ts`, `"R5: the live review-fix writers keep known zero and unknown apart"` | PASS |
| AC19 a known zero stays a real observed zero | `test/task-2369-regressions.test.ts`, `"R5: the live review-fix writers keep known zero and unknown apart"` | PASS |
| AC20 carry-forward ignores NULL rows when finding a prior known maximum | `test/task-2369-regressions.test.ts`, `"R5: carrying a prior count forward skips NULL rows, and a read failure stays unknown"` | PASS |
| SC25/AC21 a measurement-store read failure never manufactures zero | `test/task-2369-regressions.test.ts`, `"R5: carrying a prior count forward skips NULL rows, and a read failure stays unknown"` | PASS |
| SC06/AC22/AC23 SQL NULL round-trips as unknown, not zero | `test/task-2369-regressions.test.ts`, `"R5: the live review-fix writers keep known zero and unknown apart"` — asserts both mapping directions and a stable re-upsert | PASS |
| SC07 `canonicalizeStatsRow()` leaves unknown alone (already correct at baseline) | `src/adapters/cli/commands/stats.ts`, `canonicalizeStatsRow()` skips `pr_fix_rounds` in the `USAGE_NUMBERS` default loop; covered by `test/task-2369-regressions.test.ts`, `"R5: the live review-fix writers keep known zero and unknown apart"` | PASS |
| SC08/SC17/AC24/AC25 `[0, 2, unknown, unknown]` yields exactly two observations | `test/task-2369-regressions.test.ts`, `"R6: [0, 2, unknown, unknown] reports exactly two review-fix observations"` — `cohort.n === 4`, `observationCounts.reviewFixRounds === 2` | PASS |
| AC38 R5/R6 old-bug sensitivity demonstrated | restoring `unknown -> '0'` in `defaultPrFixRounds()` and `measurementToStatsRow()` turned R5, R5 carry-forward, and R6 red; restored | PASS |
| No regression elsewhere | `npm test` — 2222 pass, 0 fail | PASS |

Next action: CP-5 — run the full contradiction sweep over the final tree (classifying each match for `command: { type: 'integrate' }`, `promoteTaskForIntegrationIfNeeded`, `decideIntegration`, `new Date().toISOString()`, `pr_fix_rounds ?? 0`, `reviewFixRounds ?? 0`, `defaultPrFixRounds`, `measurementToStatsRow`, `closed`, `isCompletedStatisticsRow`, `product.name`, `resolveStatsRepoName`), confirm Parts F/G/H need no code change, then run `./scripts/verify-local.sh all` and `git diff --check`.
