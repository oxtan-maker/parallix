# CP-0 — Inventory

## Baseline

| Item | Value |
|---|---|
| BASELINE_SHA | `f7b31142e20e236102c458aad44d74b8957a4a93` |
| Branch | `mission/task-2357` |
| Working tree | 10 modified files (stats.ts, stats-cohorts.ts, stats-report.ts, consumer-domain-requirements.ts, 6 test files) — minor line-number adjustments and rename from previous work |

## Defect Status at Baseline

| Defect | Test File | Status | Evidence |
|---|---|---|---|
| A — historical pre-intake leakage | `test/task-2357.a-historical-intake.test.ts` | **Green** (already fixed) | `hasRecordedIntake()` at `metrics.ts:407` checks `transition.from === null`; `entryToMissionTransition()` at `metrics-read-adapter.ts:596` preserves null; `historicalInitialStates` filter at `metrics.ts:552-553` |
| B — canonical repository identity | `test/task-2357.b-canonical-repository-identity.test.ts` | **Green** (already fixed) | `statsCohorts()` at `stats-cohorts.ts:209` uses `resolveCanonicalRepositoryId(rootDir)`; `stats.ts:281` uses same; `stats.ts:140-145` falls back to canonical resolver |
| C — unknown reviewFixRounds | `test/task-2357.c-unknown-review-fix-rounds.test.ts` | **Red** (still broken) | `MissionOutcome.reviewFixRounds: number` (non-null) at `usage.ts:111`; adapter coerces `?? 0` at `metrics-read-adapter.ts:257,271`; cohort count uses `members.length` at `cohorts.ts:289` |
| D — completion population | `test/task-2357.d-completion-population.test.ts` | **Green** (already fixed) | `usageRecordsToOutcomes()` at `metrics-read-adapter.ts:283-310` uses lifecycle `completedAt` as authority; telemetry-only fallback only when no lifecycle |
| E — repository-scoped legacy fallback | `test/task-2357.e-legacy-history-scope.test.ts` | **Green** (already fixed) | `deriveLifecycleEntries()` at `metrics-read-adapter.ts:378-380` filters `data.repositoryId === this.repositoryId` |
| F — measured zero throughput | `test/task-2357.f-measured-zero-throughput.test.ts` | **Green** (already fixed) | `weeklyThroughputSeries()` at `metrics.ts:437-438` takes `hasLifecycleActivity`; `buildMetrics()` at `metrics.ts:558` passes `input.transitions.length > 0` |
| G — per-metric low-sample | `test/task-2357.g-per-metric-evidence.test.ts` | **Red** (still broken) | `compareCohorts()` at `cohorts.ts:269` uses `members.length < threshold` for `lowSample`; no per-metric flag exists |

## Production Call Graph (A-G)

```
stats CLI / BoardProjectionBuilder
  → ConcreteMetricsReadAdapter.buildMetrics()
    → laneEventRepo.findByRepositoryId()       (lane events)
    → usageRepo.findAll()                       (telemetry)
    → entriesToTransitions()                    (B: null from preserved)
    → usageRecordsToOutcomes()                  (C: ?? 0 coercion, D: lifecycle authority)
    → deriveLifecycleEntries()                  (E: repo-scoped filter)
    → buildMetrics()
      → historicalInitialStates filter          (A: hasRecordedIntake)
      → weeklyThroughputSeries()                (F: hasLifecycleActivity)
      → compareCohorts()
        → observationCounts                     (C: members.length, G: cohort-level only)
        → lowSample                             (G: members.length < threshold)
    → compareCohorts()                          (C, G)
```

## Classified Searches

| Pattern | Files | Relevance |
|---|---|---|
| `from === null` | `metrics.ts:412`, `metrics-read-adapter.ts:596` | A: intake detection |
| `resolveCanonicalRepositoryId` | `stats.ts:91`, `stats-cohorts.ts:19` | B: identity resolution |
| `pr_fix_rounds ?? 0` | `metrics-read-adapter.ts:257,271` | C: null→0 coercion |
| `reviewFixRounds: number` | `usage.ts:111` | C: non-nullable type |
| `members.length` (observation count) | `cohorts.ts:289` | C, G: wrong count |
| `lowSample: members.length < threshold` | `cohorts.ts:269` | G: cohort-level only |
| `data.repositoryId === this.repositoryId` | `metrics-read-adapter.ts:380` | E: already scoped |
| `hasLifecycleActivity` | `metrics.ts:437-438,558` | F: already handled |
| `lifecycle?.completedAt` | `metrics-read-adapter.ts:283` | D: lifecycle authority |

## Fixture Infrastructure

- `test/fixtures/task-2357-statistics-fixture.ts` — shared fixture with real SQLite, lane events, usage rows, Git worktrees
- 7 test files (A-G), one per defect

## Next Action

Write CP-1 red baseline document proving A/B/D/E/F already satisfied at baseline and C/G red. Then fix C (reviewFixRounds nullable) and G (per-metric low-sample).
