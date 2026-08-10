# CP-1: Stats workflow application boundary

Defined the application-owned `StatsWorkflowPort` and added `StatsCommandUseCase`.
The use case loads rows through its port, selects weekly/range/mission mode,
uses `StatisticsService` for identity and windowing, and returns data for the
CLI adapter to render.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Stats workflow port covers measurement loading, classification, implementer/fix rounds, repository name, and optional Forgejo lookup | `src/application/ports/cli-workflows.ts:9` | PASS |
| Use case resolves weekly, range, and mission modes then returns workflow data | `src/application/stats-command-use-case.ts:49` | PASS |
| Canonical identity and windowing remain delegated to StatisticsService | `src/application/stats-command-use-case.ts:2` | PASS |
| New application files type-check | `npx tsc --noEmit --allowJs --checkJs --target es2022 --module nodenext --moduleResolution nodenext src/application/stats-command-use-case.ts src/application/ports/cli-workflows.ts` | PASS |

Next action: replace the stats adapter’s weekly, range, and mission report entry path with a port-backed `StatsCommandUseCase` invocation while preserving CSV and cohort boundaries.
