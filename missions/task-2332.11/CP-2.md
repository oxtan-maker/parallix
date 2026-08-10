# CP-2: Delegate the stats report entry path

Refactored the normal measurement-database paths in `stats` to construct one
port-backed `StatsCommandUseCase` and render its returned rows. CLI argument
parsing, CSV handling, reporting, output-file writes, and exit-code mapping
remain in the adapter. Cohorts and the explicit legacy CSV boundary remain
separate paths.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Adapter supplies the infrastructure implementation of the application port | `src/adapters/cli/commands/stats.ts:248` | PASS |
| Mission, weekly, and range database report paths call `StatsCommandUseCase.execute()` | `src/adapters/cli/commands/stats.ts:2287` | PASS |
| Parsing, rendering, output-file writes, and exit mapping remain in the CLI adapter | `src/adapters/cli/commands/stats.ts:2176` | PASS |
| Existing stats routing and report characterization tests pass | `npm test -- test/stats-command-routing.test.ts test/stats-csv-authority-guard.test.ts test/stats.test.ts`; `"stats command prints workflow weekly tables from the integration stats schema"` | PASS |
| Changed files have no ESLint findings | `npx eslint src/application/ports/cli-workflows.ts src/application/stats-command-use-case.ts src/adapters/cli/commands/stats.ts` | PASS |

Next action: inject the stats port and use case from `create-cli.ts`, then confirm named exports and the project-wide verifier behavior.
