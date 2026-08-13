# Mission: Remove CSV import from stats.ts (task-2369.01)

## Goal
Delete all legacy CSV import code from `src/adapters/cli/commands/stats.ts` and its test files, then remove `@ts-nocheck` so the file passes `--checkJs`.

## Why Now
ADR 0053 made SQLite the sole statistics authority. `stats.csv` is now an explicit, operator-invoked, read-only import only. The CSV import path (`px stats import-legacy`) and its supporting functions are dead code that inflates `stats.ts` to 2499 lines and blocks `--checkJs`.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: Dead-code removal (10+ functions, 2 test files, 1 CLI subcommand), `@ts-nocheck` removal, file size reduction below 2000 lines

## Scope
- Delete from `src/adapters/cli/commands/stats.ts`:
  - Functions: `parseCsvLine`, `loadCsv`, `readLegacyStatsCsv`, `analyzeLegacyStatsCsv`, `applyLegacyStatsCsv`, `runLegacyCsvImportCommand`
  - Constants: `LEGACY_HEADERS`, `IMPORT_DATE_RE`
  - Repo-identity helpers (exist solely for CSV repo matching): `legacyStatsRepoAliases`, `statsRepoIdentities`
  - `import-legacy` subcommand routing block (`if (args[0] === 'import-legacy')`) in the `stats()` main function
  - `@ts-nocheck` directive and its explanatory comment block
  - Removed symbols from the export list
- Update `renderMissionPhaseReport` to use `[resolveStatsRepoName(opts.rootDir)]` directly instead of `statsRepoIdentities()` (legacy alias read-side fallback no longer needed)
- Update `src/adapters/cli/commands/stats-backfill.ts` help text that references `px stats import-legacy`
- Delete test files (all tests target removed functions):
  - `test/stats-merge-conflict.test.ts` (7 tests: `loadCsv`, `readLegacyStatsCsv`)
  - `test/legacy-stats-csv-import.test.ts` (13 tests: `analyzeLegacyStatsCsv`, `applyLegacyStatsCsv`, `runLegacyCsvImportCommand`)

## Out of Scope
- `px review --import-legacy` (different command, different code path in `src/adapters/review/`)
- `src/adapters/sqlite/importer.ts` CSV parsing (separate `parseCsvLine` method on `SqliteImporter`)
- Any other CSV handling outside `stats.ts`

## Success Criteria
- **SC1:** `./scripts/verify-local.sh static-analysis` passes (ESLint + tsc --checkJs + test-hygiene)
- **SC2:** No runtime path in `stats.ts` references removed functions (`parseCsvLine`, `loadCsv`, `readLegacyStatsCsv`, `LEGACY_HEADERS`, `analyzeLegacyStatsCsv`, `applyLegacyStatsCsv`, `runLegacyCsvImportCommand`, `IMPORT_DATE_RE`, `statsRepoIdentities`, `legacyStatsRepoAliases`)
- **SC3:** `@ts-nocheck` removed from `stats.ts`; no new `--checkJs` type errors
- **SC4:** `stats.ts` line count below 2000 lines
- **SC5:** `test/stats-merge-conflict.test.ts` and `test/legacy-stats-csv-import.test.ts` deleted
- **SC6:** `renderMissionPhaseReport` still compiles and routes `repos` correctly (uses `[resolveStatsRepoName(opts.rootDir)]`)
- **SC7:** `stats-backfill.ts` help text no longer references `px stats import-legacy`

## Risks and Assumptions
- **Risk:** Removing `legacyStatsRepoAliases` drops read-side fallback for rows persisted under historic `product.name`. New writes use canonical id (TASK-2363), so impact limited to old rows.
- **Risk:** `stats.ts` after CSV removal may still have implicit-any warnings that block `--checkJs`. The backlog task assumes removal drops the file enough; if 180+ implicit-anys remain, `@ts-nocheck` removal scope expands.
- **Assumption:** No external code outside `stats.ts` imports removed symbols (`parseCsvLine`, `loadCsv`, `readLegacyStatsCsv`, `LEGACY_HEADERS`, `analyzeLegacyStatsCsv`, `applyLegacyStatsCsv`, `runLegacyCsvImportCommand`, `IMPORT_DATE_RE`, `statsRepoIdentities`, `legacyStatsRepoAliases`). Verified via grep — only the two test files import them.
- **Assumption:** `renderMissionPhaseReport` caller at L1252 is the only non-CSV consumer of `statsRepoIdentities`. Verified via grep.

## Checkpoints
- CP 1: Delete CSV functions, constants, and `import-legacy` routing from `stats.ts`. Update `renderMissionPhaseReport` to inline repo identity. Fix export list.
- CP 2: Remove `@ts-nocheck` and its comment block. Resolve any `--checkJs` errors surfaced. Update `stats-backfill.ts` help text. Delete both test files. Verify with `./scripts/verify-local.sh static-analysis`.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using durable, verifiable references. Parallix already accepts:
  1. **Recognized repo commands or paths** — e.g., `` `./scripts/verify-local.sh static-analysis` ``
  2. **Test names** — e.g., `"loadCsv parses cleaned CSV"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/stats-merge-conflict.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0053` (must correspond to an existing file under `docs/adr/`)
  5. **File:line references** — accepted when needed, but line numbers eventually rot; prefer the forms above
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| CSV functions removed from stats.ts | `src/adapters/cli/commands/stats.ts` — grep for `parseCsvLine`, `loadCsv`, `readLegacyStatsCsv`, `analyzeLegacyStatsCsv`, `applyLegacyStatsCsv`, `runLegacyCsvImportCommand` returns 0 hits | PASS |
| @ts-nocheck removed | `src/adapters/cli/commands/stats.ts` — line 3 no longer `// @ts-nocheck` | PASS |
| Test files deleted | `test/stats-merge-conflict.test.ts` and `test/legacy-stats-csv-import.test.ts` no longer exist | PASS |
| Static analysis passes | `./scripts/verify-local.sh static-analysis` | PASS |

## Gates
- [ ] `./scripts/verify-local.sh static-analysis`

## Restricted Areas
- `src/adapters/sqlite/importer.ts` — has its own `parseCsvLine`; do not modify
- `src/adapters/review/` — `--import-legacy` there is a different feature
- `src/adapters/cli/commands/stats-backfill.ts` — only update the help text reference to `import-legacy`; do not refactor the file

## Stop Rules
- Do not add new CSV functionality; this is deletion only
- Do not add new tests; deleted test files cover removed code
- If `@ts-nocheck` removal surfaces >20 implicit-any errors beyond the CSV block, scope the fix to those errors only — do not re-type the entire file
- If `renderMissionPhaseReport` breaks without `statsRepoIdentities`, keep `statsRepoIdentities` as a thin wrapper returning `[resolveStatsRepoName(...)]` and note in checkpoint
