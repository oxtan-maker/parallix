# CP-1: Create stats-report-rendering.ts

## Summary

Created `src/adapters/cli/commands/stats-report-rendering.ts` (821 lines) containing every symbol
named in the mission scope, moved verbatim from `stats.ts`:

- `groupBy`, `computeImplStats`, `computePeriodStats`, `generateMarkdownReport`
- `summarizeMissionWindow`, `computeAgentMissionGroups`, `summarizeAgentWindow`, `summarizeAgentStageSpend`
- `formatAgentSpendCell`, `colorAverageFixRounds`, `colorMissionCounts`
- `AGENT_SPEND_STAGE_COLUMNS`, `MISSION_PHASE_ORDER`
- `classifyAgentSpendFamily`, `renderMissionPhaseReport`

The mission text says "16 symbols"; the enumerated list in both the mission Scope section and the
Backlog task contains 15 (13 functions + 2 constants). All 15 enumerated symbols were moved.

To keep the new module a leaf (mission Risks: no import back into `stats.ts`, no cycle), the private
helpers that only the extracted functions used were moved with them, and they are exported so
`stats.ts` can import back the three it still re-exports via `_internals`:

- `formatDate`, `statsMissionKey`, `modelBelongsToImplFamily`, `rowInWindow` — no remaining caller in `stats.ts`
- `parseBooleanish`, `normalizeRow`, `normalizeRows` — only referenced by `stats.ts` in its `_internals` block
- `isValidClassification`, `normalizeClassification`, `VALID_CLASSIFICATIONS` — `normalizeClassification` still has two callers in `stats.ts`, which will import it from here

`renderMissionPhaseReport` previously called `resolveStatsRepoName(opts.rootDir)`, which stays in
`stats.ts`. It now calls its single owner directly —
`resolveCanonicalRepositoryId(opts.rootDir || process.cwd())` — which is exactly what
`resolveStatsRepoName` does, so no duplicated wrapper and no back-import.

`stats.ts` is untouched by this checkpoint; both copies of the symbols exist until CP-2 removes the
originals. That is why the full-project typecheck is not yet expected to reflect the extraction.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: new module exists and exports the enumerated symbols | `grep -n "^export {" -A 30 src/adapters/cli/commands/stats-report-rendering.ts` lists all 15 mission symbols plus 10 moved private helpers | PASS |
| New module compiles (CP-1 gate) | `npx tsc --noEmit -p tsconfig.json` reports zero errors matching `stats-report-rendering` | PASS |
| New module lints clean | `npx eslint src/adapters/cli/commands/stats-report-rendering.ts` — no output | PASS |
| No missing imports / no cycle | `grep -n "^import" src/adapters/cli/commands/stats-report-rendering.ts` → `cli-format.js`, `stats-report.js`, `repository-identity.js`, `statistics-service.js`; no `./stats.js` import (mission Risks: leaf module) | PASS |
| Rendering behavior unchanged | Function bodies copied byte-for-byte from `stats.ts` ranges; only `renderMissionPhaseReport`'s repo resolution rewritten to its owner `resolveCanonicalRepositoryId` (ADR 0053 measurement identity) | PASS |

Next action: CP-2 — delete the moved ranges from `src/adapters/cli/commands/stats.ts`, add the `./stats-report-rendering.js` import + re-export, confirm `wc -l src/adapters/cli/commands/stats.ts` <= 1650, then run `./scripts/verify-local.sh static-analysis`.
