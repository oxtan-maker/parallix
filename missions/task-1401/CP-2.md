# CP-2: Fix unused imports

## Summary

Removed all unused type/value imports across 2 files:

1. **lib/commands/stats.ts** — Removed 12 unused type interfaces (`CsvData`, `TelemetryToStatsOptions`, `UpsertStatsRowOptions`, `RecordStageStatsOptions`, `RecordIntegrationStatsOptions`, `RecordActiveStatsOptions`, `RecordReviewStatsOptions`, `RenderWeeklyStatsReportOptions`, `RenderRangeStatsReportOptions`, `MissionStats`, `AccModeOptions`, `StatsCmdOptions`) and removed unused `getPrimaryWorktree` from the `mission-utils` import. Also fixed `args` → `_args` in `GitRunner` interface in lib/core/git.ts.

2. **lib/core/git.ts** — Removed unused `childProcess` import (kept `spawnSync` which is actively used).

## Goal Check

| Criterion | Evidence |
|-----------|----------|
| Unused type imports removed from stats.ts | `lib/commands/stats.ts:31-162` — interfaces `CsvData`, `TelemetryToStatsOptions`, `UpsertStatsRowOptions`, `RecordStageStatsOptions`, `RecordIntegrationStatsOptions`, `RecordActiveStatsOptions`, `RecordReviewStatsOptions`, `RenderWeeklyStatsReportOptions`, `RenderRangeStatsReportOptions`, `MissionStats`, `AccModeOptions`, `StatsCmdOptions` all removed |
| `getPrimaryWorktree` import removed | `lib/commands/stats.ts:109` — `import { findMissionDir } from '../core/mission-utils.js'` (no `getPrimaryWorktree`) |
| `childProcess` import removed from git.ts | `lib/core/git.ts:1` — `import { spawnSync } from 'node:child_process'` (no `childProcess`) |
| `npx tsc --noEmit` clean | `npx tsc --noEmit` — no output (0 errors) |
| ESLint clean on changed files | `npx eslint lib/commands/stats.ts lib/core/git.ts` — no output (0 errors) |

## Next action: Fix CP 3 — rename unused caught-error bindings to underscore-prefixed in agents.ts, draft.ts, mission-utils.ts
