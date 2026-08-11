# CP-6 — Integrity fixes

## Summary

### Defect B — one repository identity for new statistics data

`resolveStatsRepoName` in `src/adapters/cli/commands/stats.ts` preferred the
configured `product.name` over `resolveCanonicalRepositoryId`. Because
`DEFAULT_CONFIG` ships `product.name = 'Workflow'`, **every checkout without an
explicit config wrote its measurement rows under the single literal identity
`Workflow`**, while mission lifecycle lane events were written under the
canonical git-derived id. The two could never join.

- `resolveStatsRepoName` now returns `resolveCanonicalRepositoryId(rootDir)` and
  nothing else. Every new write — `normalizeStatsRow`, `canonicalizeStatsRow`,
  `stats-backfill`, the `resolveRepositoryName` workflow port — goes through it.
- `legacyStatsRepoAliases()` is the narrow, explicit legacy read strategy: the
  configured `product.name`, and only when it differs from the canonical id.
- `statsRepoIdentities()` composes the two for read-side row matching and is
  passed to `renderMissionPhaseReport` (`src/adapters/cli/commands/stats-report.ts`),
  the only report that filters rows by repository. No query was broadened, and
  no join was weakened to mission id alone.

### Defect A — unknown `reviewFixRounds`

The SQLite → read → `MissionOutcome` → cohort path already preserved SQL NULL
(TASK-2357 defect C, still passing). The remaining gap was on the **producer**:
`recordStageStats` and `accumulateStageStats` defaulted `prFixRounds` to `'0'`,
so every draft and active stage row claimed a measured zero review-fix count.
Both defaults are now `undefined`, which `canonicalizeStatsRow` already skips, so
the column persists as SQL NULL. A caller that genuinely knows a count still
passes it, and a known `0` is still stored as `0`. Read-back through
`measurementToStatsRow` still renders `'0'`, so `px stats` output is unchanged.

### Existing tests updated for the intended change

- `test/stats.test.ts` — `"recording a measurement with no explicit path writes
  no CSV under PARALLIX_HOME (task-1246)"` asserted the split identity itself
  (`repo === 'visualboard'`). It now asserts each row is written under its
  checkout's canonical id and explicitly `notEqual` to the display alias.
- `test/task-2337-repro.test.ts` — used the shared home database and relied on
  every fixture collapsing to the `Workflow` identity; given an isolated
  `dbPath`.
- `test/task-2347-01-repository-identity-repro.test.ts`,
  `test/task-2347.05-cycle-time-vs-runtime.test.ts` — projection clocks pinned
  beside their fixed fixture dates; the latter's FLOW assertions updated to the
  CP-5 labels (`Lifecycle cycle median`, `Agent runtime median`).
- `src/application/consumer-domain-requirements.ts` — the two `stats.ts` consumer
  citations re-anchored to their moved lines (114→117, 512→540).

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC19 / AC21 — new measurement records use the canonical `repositoryId` | `"writes new measurement rows under the canonical repository id, not product.name"` in `test/task-2363-repository-identity.test.ts` | PASS |
| AC22 — a different `product.name` creates no split identity | same test asserts `notEqual` to `deliberately-different-display-name`; `"resolves the same identity from a worktree carrying the same display alias"` | PASS |
| New lifecycle + measurement data from either checkout joins | `"joins new lifecycle and measurement data written from either checkout"` — cohort n=2 through `ConcreteMetricsReadAdapter` over a migrated SQLite database | PASS |
| SC20 / AC23 — repository B with an overlapping mission id cannot contaminate A | `"keeps repository B with an overlapping mission id out of repository A"` asserts `completedMissions` 1, runtime 10, cohorts `['ai_sdlc']` | PASS |
| AC24 — legacy alias is explicit and read-only | `legacyStatsRepoAliases` / `statsRepoIdentities` in `src/adapters/cli/commands/stats.ts`; consumed only by `renderMissionPhaseReport` in `src/adapters/cli/commands/stats-report.ts` | PASS |
| SC17 / AC18 — unknown `reviewFixRounds` stays unknown from the producer | `"writes SQL NULL when a stage row has no review-fix count yet"` in `test/task-2363-review-fix-rounds.test.ts` | PASS |
| SC18 / AC19 — a known zero stays distinguishable | `"keeps an explicitly recorded zero as a zero"` and `"carries the distinction through to the windowed cohort"` (population n=2, `observationCounts.reviewFixRounds` 1, median 0) | PASS |
| AC20 — unknown values do not contribute to the aggregate or its count | same test; plus `test/task-2357.c-unknown-review-fix-rounds.test.ts` still passes | PASS |
| SC16 / AC17 — `px stats` weekly output unchanged | `test/stats.test.ts`, `test/stats-report.test.ts`, `test/review-stats.test.ts`, `test/mission-phase-stats.test.ts`, `test/stats-backfill.test.ts`, `test/stats-command-routing.test.ts`, `test/stats-command-use-case.test.ts`, `test/legacy-stats-csv-import.test.ts`, `test/stats-task-1380-closed-filter.test.ts` — 167 pass, 0 fail | PASS |
| Whole verification gate green | `./scripts/verify-local.sh all` exits 0, `fail 0` | PASS |

Next action: CP-7 — author `test/task-2363-certification.test.ts`: real temporary Git primary repo plus worktree plus a second repo, migrated SQLite, production persistence adapters, the 240 + 28 + 31 contaminated-history fixture, boundary and missing-telemetry missions, a hand-computed oracle, and a guard asserting no agent-launch path is instantiated.
