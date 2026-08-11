# CP-4 — Measurement Evidence (C, G)

## Summary

Fixed two defects: C (reviewFixRounds nullable end-to-end) and G (per-metric low-sample). Both regression tests now green.

## Defect C — Unknown reviewFixRounds survive to presentation

### Changes

| File | Line | Change |
|---|---|---|
| `src/domain/usage.ts` | 111 | `MissionOutcome.reviewFixRounds: number` → `number \| null` |
| `src/domain/usage.ts` | 147 | `CompletedMissionStatistics.reviewFixRounds: number` → `number \| null` |
| `src/application/projections/metrics-read-adapter.ts` | 237 | `reviewFixRounds: number \| null` in outcomeMap type |
| `src/application/projections/metrics-read-adapter.ts` | 257-259 | Aggregation: `record.pr_fix_rounds !== undefined ? Math.max(existing.reviewFixRounds ?? -1, record.pr_fix_rounds) : existing.reviewFixRounds` |
| `src/application/projections/metrics-read-adapter.ts` | 271 | `reviewFixRounds: record.pr_fix_rounds ?? null` (was `?? 0`) |
| `src/application/projections/metrics-read-adapter.ts` | 300 | Lifecycle-only mission: `reviewFixRounds: null` (was `0`) |
| `src/application/projections/cohorts.ts` | 63 | `observationCounts.reviewFixRounds: number \| null` type |
| `src/application/projections/cohorts.ts` | 277-279 | `median()` filters nulls: `.filter((value): value is number => value !== null)` |
| `src/application/projections/cohorts.ts` | 289 | `reviewFixRounds: members.filter(o => o.reviewFixRounds !== null).length` (was `members.length`) |
| `src/adapters/cli/commands/stats.ts` | 426-428 | `normalizeStatsRow`: `pr_fix_rounds === null || pr_fix_rounds === undefined ? undefined : String(...)` |
| `src/adapters/cli/commands/stats.ts` | 1630-1633 | `canonicalizeStatsRow`: skip `pr_fix_rounds` when `canonical[key] === undefined` |
| `src/adapters/cli/commands/stats.ts` | 221 | `statsRowToMeasurement`: `row.pr_fix_rounds === undefined ? null : int(...)` |

### Audit of remaining `?? 0` / `|| 0` for pr_fix_rounds

| Location | Pattern | Valid? | Reason |
|---|---|---|---|
| `stats.ts:1053` | `parseInt(String(row.pr_fix_rounds), 10) \|\| 0` | Yes | Display default for agent performance table — renders 0 when value absent |
| `stats.ts:1926` | `record.pr_fix_rounds ?? 0` | Yes | Display fallback in `defaultPrFixRounds()` — returns `'0'` string for rendering |

### Test Evidence

| Test | Expected | Status |
|---|---|---|
| `task-2357.c-unknown-review-fix-rounds.test.ts` "stores an unknown count as SQL NULL" | SQL NULL in DB, observationCount=2, median=1 | Green |
| `task-2357.c-unknown-review-fix-rounds.test.ts` "keeps a measured zero distinct from an unknown" | known=0, unknown=null | Green |

## Defect G — Per-metric low-sample judgement

### Changes

| File | Line | Change |
|---|---|---|
| `src/application/projections/cohorts.ts` | 43-60 | `CohortMetrics` interface: add `lowSamplePopulation: boolean`, `lowSample: boolean` (deprecated alias), `lowSampleByMetric: Readonly<{...}>` |
| `src/application/projections/cohorts.ts` | 269-281 | `compareCohorts()`: compute `lowSamplePopulation`, `lowSample`, and `lowSampleByMetric` per observation count |
| `src/adapters/cli/commands/cohort-report.ts` | 33-35 | `figure()`: add `isLowSample` param; append `, low-sample` suffix |
| `src/adapters/cli/commands/cohort-report.ts` | 37-51 | `cohortRow()`: pass per-metric `lowSampleByMetric` flags to `figure()` |
| `src/adapters/cli/commands/cohort-report.ts` | 82 | `renderCohortComparison()`: use `lowSamplePopulation` for cohort-level filter |

### Test Evidence

| Test | Expected | Status |
|---|---|---|
| `task-2357.g-per-metric-evidence.test.ts` "marks cost low-sample at n=2" | lowSamplePopulation=false, lowSampleByMetric.cost=true, report shows `(n=2, low-sample)` | Green |

## Next Action

CP-5 — production certification test. Check existing certification and verify it meets mission requirements.
