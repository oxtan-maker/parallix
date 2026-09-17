# CP 3 — Wire repair into `runIntegration`

## Work done
- Added `createBaseWorktreeRepair(ports)` seam and `repairBaseWorktree` call in
  `src/application/integrate/integrate-workflow.ts`, placed **after**
  `buildIntegrationContext` and **before** `loadMissionAuthority` / preflight /
  `rebaseForIntegration` / the stash (`stashMainCheckoutIfNeeded`) in
  `publishMission`. This is the single `px integrate` entry chokepoint, not a
  per-mission-branch path (SC5).
- Runs before preflight, so a repaired worktree lets preflight proceed with zero
  `rebase-in-progress` / `main-index-conflicts` failures (SC2) and a dropped
  marker stash no longer compounds (SC1).
- Existing `integrate.test.ts` still green (87/87) — stash/restore pair and
  `probeMerge` untouched (SC6).

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC5 runs before stash/rebase at entry chokepoint | `src/application/integrate/integrate-workflow.ts` `runIntegration` calls `repairBaseWorktree` after `buildIntegrationContext`, before preflight/rebase | PASS |
| SC6 existing integrate suites pass | `node --experimental-test-module-mocks --import tsx test/integrate.test.ts` → pass 87 / fail 0 | PASS |
| SC7 static analysis clean | `./scripts/verify-local.sh static-analysis` → ALL STAGES PASSED | PASS |

## Next action
Run full verification: reproduction test green, integrate suites pass, `./scripts/verify-local.sh all` and `static-analysis` clean, docs updated (CP 4).
