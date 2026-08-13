# CP-1: Remove legacy CSV command surface

Removed the legacy CSV parser, importer, repo-alias fallback, file-input routing, and public/internal exports from `stats.ts`. Stats reports now source their rows exclusively from the measurement database, and mission-phase reports pass the canonical repository identity directly.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Legacy CSV import symbols are absent from the stats command | `src/adapters/cli/commands/stats.ts` — `rg` for `parseCsvLine`, `loadCsv`, `readLegacyStatsCsv`, `analyzeLegacyStatsCsv`, `applyLegacyStatsCsv`, and `runLegacyCsvImportCommand` has no code matches | PASS |
| The `import-legacy` route and exports are removed | `src/adapters/cli/commands/stats.ts` — `createStatsCommand` handles database-backed weekly, range, mission, and cohorts reports only | PASS |
| Mission-phase repository routing uses the canonical identity | `src/adapters/cli/commands/stats.ts` — `renderMissionPhaseReport` passes `repos: [resolveStatsRepoName(opts.rootDir)]` | PASS |
| The edited command remains syntactically valid | `npx tsc --noEmit --pretty false --allowJs --checkJs false src/adapters/cli/commands/stats.ts` | PASS |

Next action: Remove the `@ts-nocheck` suppression, delete the retired CSV-only tests, update the backfill help text, then run the static-analysis gate.
