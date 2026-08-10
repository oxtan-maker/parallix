# CP-4 — `px stats cohorts` and the board's cohort read model

## Summary

The cohort comparison is now reachable from both surfaces the mission names,
and neither can show a figure without its sample size.

**CLI.** `src/adapters/cli/commands/stats-cohorts.ts` adds `px stats cohorts`
with `--by label|implementer|model|provider`, `--min-sample <n>`, `--repo <id>`
and its own `--help`. It reads the lane-event history alongside the measurement
database — lifecycle facts (dwell, bounces) live in lane events, not telemetry —
and writes nothing. `stats.ts` routes the subcommand at
`src/adapters/cli/commands/stats.ts:2175`, before the top-level `--help` check
so `px stats cohorts --help` reaches the cohort usage. The `--weekly`, `--range`
and `--mission` paths are untouched, per the restricted-area rule.

**Presentation.** `src/adapters/cli/commands/cohort-report.ts:73` renders the
table. `n` is the second column of a fixed column list
(`src/adapters/cli/commands/cohort-report.ts:16`), not an option, so a figure
cannot be rendered without it. A cohort under the threshold is marked twice —
`(low-sample)` in the cohort cell and named in a trailing note — so the flag
survives whether the reader scans the grid or the summary. An unmeasured
quantity prints `n/a`, never `0`.

**Board read model.** `BoardMetrics.cohorts`
(`src/application/projections/board.ts:146`) is a new optional field; no
existing series changed. `ConcreteMetricsReadAdapter` populates it
(`src/application/projections/metrics-read-adapter.ts:138`) on the `label`
dimension by default. Net engineering lines are a mission fact rather than
telemetry, so the adapter takes an optional async provider and
`composeBoardProjection` supplies it from the same `ConcreteMissionReadAdapter`
the board already reads (`src/composition/board-projection.ts:66`).

### Guardrail and citation repairs

Three repo-wide invariants moved with this work and were updated rather than
worked around:

- `test/board-event-guardrail.test.ts` — `stats-cohorts.ts` names
  `BoardLaneEventRepository` to *read* lane history, so it joins the existing
  contract-module allowlist beside `status.ts`. It never calls `append`.
- `src/application/persistence-domain-map.ts:77` and
  `src/application/consumer-domain-requirements.ts:284` cited
  `completedMissionStatistics` at `src/domain/usage.ts:156`; the CP-1 helper
  extraction moved it to line 197 and both citations now point there.
- `test/task-2347.08-own-statistics-semantics-repro.test.ts` was red at the
  branch tip: it `require`d `../.test-runtime/adapters/cli/commands/stats.js`,
  a path that does not exist, which failed the file outright and tripped the
  ESM-only guard on both `require(` and `.test-runtime`. It now uses the same
  default ESM import as `test/stats-report.test.ts`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC5: no cohort figure is rendered without its sample size `n` | `src/adapters/cli/commands/cohort-report.ts:16` (`n` is a fixed column); tests `"SC5: every cohort row carries an n column"` and `"SC5: no rendered figure appears on a line without its sample size"` in `test/task-2347.09-cohort-presentation.test.ts` | PASS |
| SC6: a cohort with `n < 5` is marked low-sample, not presented as comparable | test `"SC6: a cohort of 3 missions is marked low-sample, not presented as comparable"` asserts `(low-sample)` on both 3-mission cohorts and the note `Low-sample (n < 5), not comparable results: ai_sdlc (n=3), user_value (n=3).` | PASS |
| The low-sample threshold is a stated, adjustable rule | test `"SC6: raising the threshold past a cohort flips it to low-sample"`; `--min-sample` parsed at `src/adapters/cli/commands/stats-cohorts.ts:69` | PASS |
| Cohort comparison exposed through `px stats` | `src/adapters/cli/commands/stats.ts:2175`; tests `"px stats cohorts renders the comparison with sample sizes from stored history"`, `"px stats cohorts groups by the requested dimension and honours --min-sample"` and `"px stats routes the cohorts subcommand without touching the weekly or range paths"` | PASS |
| Cohort comparison exposed through the board read model | `src/application/projections/board.ts:146`; `src/application/projections/metrics-read-adapter.ts:138`; test `"the board read model exposes the cohort comparison with sample sizes"` | PASS |
| NEL reaches the board's cohorts from `ClosedMission` data | `src/composition/board-projection.ts:66` (async provider over `missions.loadAllMissions()`) | PASS |
| An unmeasured figure is not rendered as zero | test `"an unmeasured figure renders as n/a rather than zero"` in `test/task-2347.09-cohort-presentation.test.ts` | PASS |
| A bad dimension is rejected instead of silently reporting another | test `"px stats cohorts rejects an unknown dimension instead of reporting a wrong one"` | PASS |
| `stats.ts` restricted area respected: `--weekly`/`--range`/`--mission` unmodified | the weekly, range and mission-phase suites stay green in `./scripts/verify-local.sh all` (1883 pass, 0 fail), including `"renderMissionPhaseReport renders phase table"`; the only edits to `src/adapters/cli/commands/stats.ts` are the `cohorts` route, the usage text, and the export list | PASS |
| Docs updated for the new user-facing command | `docs/authority-reference.md:315`, `docs/authority-reference.md:323` | PASS |
| CP-4 tests pass | `npm test -- test/task-2347.09-cohort-presentation.test.ts` — 11 pass, 0 fail | PASS |
| Static analysis clean | `./scripts/verify-local.sh static-analysis` — `=== Static Analysis Gate: ALL STAGES PASSED ===` (ESLint, tsc, test-hygiene, test typecheck) | PASS |

Next action: run `./scripts/verify-local.sh all` on the committed tree and record
the final Goal Check in CP-5, covering SC1–SC7 with the file:line and test-name
evidence gathered across CP-1 through CP-4.
