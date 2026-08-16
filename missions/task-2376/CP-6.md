# CP-6 — Delete obsolete stats inference

## Summary

Deleted 4 obsolete external inference helpers and all fallback paths in `deriveImplementerAndFixRounds`:

- `deriveFixRoundsFromTaskText` — derived fix rounds from backlog task file text
- `deriveFixRoundsFromReviewStateHistory` — derived from Git review-state commit subjects
- `deriveFinalImplementerFromBranchHistory` — derived implementer from Git branch history
- `deriveImplementerAndFixRoundsFromPrComments` — derived from Forgejo PR comments

`deriveImplementerAndFixRounds` now uses only the authoritative Review aggregate. Missing `MissionStore` returns `{ implementer: 'unknown', prFixRounds: null, source: 'missing-authority' }` — no heuristic fallback activated.

Deleted unused imports: `git`, `isForgejoReviewEnabled`, `getTaskImplementer`, `getTaskAssignee`, `currentReviewRound`. Kept `forgejo` (used by `lookupForgejo` in workflow adapter).

Updated `stats-backfill.ts` interface to accept optional `missionStore`. Deleted 8 obsolete tests from `test/stats.test.ts` that exercised PR/branch/backlog fallback paths. Added R10–R13 regression tests to `test/task-2376-lifecycle-timing.test.ts`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| PR-comment inference deleted | `grep -rn "deriveImplementerAndFixRoundsFromPrComments" src/` — 0 matches | PASS |
| Git/branch-history inference deleted | `grep -rn "deriveFixRoundsFromReviewStateHistory\|deriveFinalImplementerFromBranchHistory" src/` — 0 matches | PASS |
| Backlog task-text inference deleted | `grep -rn "deriveFixRoundsFromTaskText" src/` — 0 matches | PASS |
| `deriveImplementerAndFixRounds` uses Review aggregate only | `src/adapters/cli/commands/stats.ts` — single review-aggregate path, no fallback | PASS |
| Missing MissionStore returns missing-authority | `test/task-2376-lifecycle-timing.test.ts` `"R13: missing MissionStore cannot activate heuristic inference"` | PASS |
| First-pass approval yields known zero | `test/task-2376-lifecycle-timing.test.ts` `"R10: first-pass approval yields known reviewFixRounds=0"` | PASS |
| Two fix rounds yields known 2 | `test/task-2376-lifecycle-timing.test.ts` `"R11: two request-changes cycles yield known reviewFixRounds=2"` | PASS |
| External artifacts ignored when Review present | `test/task-2376-lifecycle-timing.test.ts` `"R12: external artifacts with misleading values do not affect authoritative result"` | PASS |
| 8 obsolete fallback tests deleted | `test/stats.test.ts` — 400 lines removed | PASS |
| Type check passes | `npx tsc --project tsconfig.test.json --noEmit` | PASS |
| All lifecycle timing tests pass | `npx tsx --test test/task-2376-lifecycle-timing.test.ts` — 10/10 pass | PASS |
| Existing review-aggregate tests pass | `npx tsx --test test/task-2347.10-repro.test.ts test/task-2348-implementer-attribution.test.ts` — 12/12 pass | PASS |

Next action: CP-7 — review metric certification (R10–R13 already covered), then CP-8 lifecycle statistics proof.
