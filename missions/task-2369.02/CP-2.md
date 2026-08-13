# CP-2: Thin stats.ts to import + re-export

## Summary

Removed the extracted symbols from `src/adapters/cli/commands/stats.ts` and wired the module back
through `./stats-report-rendering.js`:

- Deleted the three moved regions (rendering helpers + markdown report, mission/agent window
  summaries + spend/color helpers, `MISSION_PHASE_ORDER` + `renderMissionPhaseReport`), plus the
  now-unused `VALID_CLASSIFICATIONS` const.
- Added one `import { ... } from './stats-report-rendering.js'` block covering the 12 symbols
  `stats.ts` still names (all 15 extracted symbols minus `groupBy`, `computeImplStats`,
  `computePeriodStats`, which only `generateMarkdownReport` uses) plus `normalizeClassification`,
  `normalizeRow`, `normalizeRows`, `parseBooleanish`, which `stats.ts` still references in
  `resolveMissionClassification`/`normalizeStatsRow` and its `_internals` block.
- Dropped `renderMissionPhaseReport: _renderMissionPhaseReport` from the `statsReport` destructure
  (that wrapper moved) and dropped the now-unused `statistics-service.js` import.
- The existing named export block and the `(stats as any).*` attachments are unchanged, so every
  caller — `stats-report.ts`, `integrate.ts`, `draft-prompts.ts`, `review-agent-fallback.ts`, and the
  test files — keeps resolving these symbols from `./stats.js`.

**Pre-existing baseline repair (type-only, no behavior change):** `main` fails
`./scripts/verify-local.sh static-analysis` with 5 `tsc` errors in `stats.ts` — verified by running
`npx tsc --noEmit` in a clean `main` worktree, which reported errors at `stats.ts(154,28)`,
`(1935,79)`, `(1935,99)`, `(1956,79)`, `(1956,99)`. They are untouched by this extraction but block
the mission gate, so they are repaired minimally: one `// @ts-ignore` above `nullableNumeric`
(matching the idiom already used throughout the file), and `const opts: any = options` in
`recordActiveStats`/`recordReviewStats` — the `/** @type {any} */` JSDoc cast above those lines is
inert in a `.ts` file, which is why `rest.store`/`rest.dbPath` did not check.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC2: `stats.ts` line count <= 1650 | `wc -l src/adapters/cli/commands/stats.ts` → 1453 (was 2209) | PASS |
| SC3: extracted symbols imported from `./stats-report-rendering.js` and re-exported | `grep -n "stats-report-rendering.js" src/adapters/cli/commands/stats.ts`; the named `export { ... }` block still lists `renderMissionPhaseReport`, `summarizeMissionWindow`, `summarizeAgentWindow`, `summarizeAgentStageSpend`, `formatAgentSpendCell`, `colorAverageFixRounds`, `colorMissionCounts`, `AGENT_SPEND_STAGE_COLUMNS`, `MISSION_PHASE_ORDER`, `computeAgentMissionGroups` | PASS |
| SC4: static-analysis gate passes | `./scripts/verify-local.sh static-analysis` → `=== Static Analysis Gate: ALL STAGES PASSED ===` (ESLint, tsc typecheck, test-hygiene, test typecheck) | PASS |
| No import cycle introduced | `grep -n "from './stats.js'" src/adapters/cli/commands/stats-report-rendering.ts` → no match; ESLint stage of `./scripts/verify-local.sh static-analysis` clean | PASS |
| Baseline `tsc` failure is pre-existing on `main`, not caused by this extraction | `git worktree add /tmp/base-2369 main && npx tsc --noEmit` in that worktree → same 5 `src/adapters/cli/commands/stats.ts` errors | PASS |

Next action: CP-3 — run `test/stats-report.test.ts`, `test/mission-phase-stats.test.ts`, `test/task-2369-regressions.test.ts`, `test/stats-active-breakdown.test.ts`, `test/task-2348-implementer-attribution.test.ts`, and `test/task-2347.08-own-statistics-semantics-repro.test.ts` (SC5–SC10), and confirm `stats-report.ts` / `integrate.ts` still compile (SC11–SC12).
