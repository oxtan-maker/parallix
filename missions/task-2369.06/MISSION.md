# Mission: Split integrate.ts — extract conflict resolution and post-integration (task-2369.06)

## Goal
Extract conflict resolution helpers and post-integration stats/diagnostics from `integrate.ts` into two new modules (`integrate-conflict.ts`, `integrate-post.ts`) so that, combined with .04 and .05, `integrate.ts` drops below 1000 lines and each concern lives in its own file.

## Why Now
`integrate.ts` is 2366 lines. Tasks .04 (command orchestration, ~350 lines) and .05 (gates + worktree, ~500 lines) split the top and middle layers. .06 splits the bottom two layers: conflict resolution (~14 functions) and post-integration stats/diagnostics (~22 functions + constants). This completes the 3-way decomposition so `integrate.ts` becomes a thin barrel file (~700 lines net after all three land).

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: mechanical extraction (move functions, update imports, add re-exports). No behavior change. Risk is purely import/re-export wiring.

## Scope
- Create `src/adapters/cli/commands/integrate-conflict.ts` with 14 conflict-resolution functions: `resolveConflictsForMission`, `buildConflictResolutionPrompt`, `rewriteWorktreePaths`, `stashMainCheckoutIfNeeded`, `restoreMainCheckoutStash`, `getUnresolvedIndexConflicts`, `areAllBacklogOnlyConflicts`, `parseStashPopCollisionFiles`, `reportStashPopFailure`, `findExistingSquashCommit`, `prepareNoisePatchForSquash`, `restoreNoisePatchAfterSquash`, `maybeUpdateGraphifyOnPrimary`
- Create `src/adapters/cli/commands/integrate-post.ts` with 21 post-integration functions/constants: `recordPostIntegrationStats`, `recordPostIntegrationStatsOrAbort`, `persistLandedIntegrationOrAbort`, `runPostIntegrateHookOrAbort`, `cleanupMissionWorktree`, `recordStageStats`, `accumulateStageStats`, `defaultPrFixRounds`, `recordIntegrationStats`, `recordActiveStats`, `recordReviewStats`, `telemetryToStatsFields`, `formatRecordedStatsRow`, `shellQuote`, `resolveForgejoUserForIntegration`, `SYNC_MERGED_DIAGNOSTICS`, `printDiagnosticTable`, `reportSyncMergedFailure`, `isNoMergeToAbortResult`
- Extract `classifyHookFailure` and `handleHookFailureAutoBounce` (see task-2369.15 for future dedup with `rebase-workflow.ts`)
- Remove extracted functions from `integrate.ts` body; add re-exports so existing callers (e.g. `test/task-2340-hook-rebounce.test.ts` importing `classifyHookFailure` from `integrate.js`) keep working
- Update any import that reaches into `integrate.ts` for a moved symbol to route through the new file (or keep re-export in `integrate.ts`)

## Out of Scope
- Dedup `classifyHookFailure`/`handleHookFailureAutoBounce` with `rebase-workflow.ts` (owned by task-2369.15)
- Behavioral changes to any extracted function
- Changes to `integrate-command.ts` or `integrate-gates.ts` (owned by .04/.05)
- Documentation updates (no user-facing change)

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1: `src/adapters/cli/commands/integrate-conflict.ts` exists and exports all 14 listed conflict-resolution functions
- SC2: `src/adapters/cli/commands/integrate-post.ts` exists and exports all 21 listed post-integration functions/constants
- SC3: `classifyHookFailure` and `handleHookFailureAutoBounce` are defined in one of the new files and re-exported from `integrate.ts`
- SC4: `integrate.ts` body does not contain the implementation of any extracted function (only re-exports remain)
- SC5: `integrate.ts` total line count is below 1000 lines after .04 + .05 + .06 all land (after .06 alone, line count must be reduced by at least 600 lines vs. pre-.06 baseline)
- SC6: `./scripts/verify-local.sh static-analysis` passes (ESLint + tsc --checkJs + test-hygiene)
- SC7: Existing test `test/task-2340-hook-rebounce.test.ts` still imports `classifyHookFailure` and `handleHookFailureAutoBounce` from `integrate.js` without modification

## Risks and Assumptions
- R1: Extracted functions may have internal cross-references (e.g. `resolveConflictsForMission` calls `rewriteWorktreePaths`). These intra-group calls must be resolved within the new file; cross-file deps on functions NOT in .06 scope stay as imports from `integrate.ts` or its sibling files.
- R2: `classifyHookFailure`/`handleHookFailureAutoBounce` are also used by `rebase-workflow.ts` (via `integrate` default import). They must remain accessible at their current import path. Re-export from `integrate.ts` is the safe path.
- A1: Tasks .04 and .05 land before or in parallel with .06 on the same branch; line-count target (SC5) is measured after all three are applied.
- A2: No runtime behavior change is expected; this is a pure move + re-export refactor.

## Checkpoints
- CP 1: Create `integrate-conflict.ts` with all 14 conflict-resolution functions. Verify `./scripts/verify-local.sh static-analysis` passes.
- CP 2: Create `integrate-post.ts` with all 22 post-integration functions/constants plus `classifyHookFailure`/`handleHookFailureAutoBounce`. Verify static analysis passes.
- CP 3: Strip extracted functions from `integrate.ts` body, add re-exports. Verify `integrate.ts` line count reduced by ≥600 lines and `./scripts/verify-local.sh static-analysis` passes. Confirm `test/task-2340-hook-rebounce.test.ts` still resolves imports.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using durable, verifiable references. Parallix already accepts:
  1. **Recognized repo commands or paths** — e.g., `` `./scripts/verify-local.sh static-analysis` ``
  2. **Test names** — e.g., `"classifyHookFailure detects pre-receive hook failures"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/task-2340-hook-rebounce.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0039` (must correspond to an existing file under `docs/adr/`)
  5. **File:line references** — accepted when needed, but line numbers eventually rot; prefer the forms above
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| integrate-conflict.ts exports 14 functions | `src/adapters/cli/commands/integrate-conflict.ts` export list | PASS |
| Static analysis passes | `./scripts/verify-local.sh static-analysis` | PASS |
| Hook-rebounce test still resolves imports | `test/task-2340-hook-rebounce.test.ts` — no import errors in tsc --checkJs | PASS |

## Gates
- [ ] `./scripts/verify-local.sh static-analysis`

## Restricted Areas
- `src/adapters/cli/commands/integrate-command.ts` (owned by .04)
- `src/adapters/cli/commands/integrate-gates.ts` (owned by .05)
- `src/adapters/rebase/rebase-workflow-adapter.ts` — do not dedup `classifyHookFailure`/`handleHookFailureAutoBounce` here (owned by task-2369.15)
- No behavior changes to extracted functions; signature and logic must remain identical

## Stop Rules
- Stop if static analysis reveals that an extracted function depends on a symbol NOT in scope (not in .06, not in `integrate.ts` after strip). Resolve by keeping that symbol in `integrate.ts` or pulling its dependency into the new file — do not expand scope to include symbols owned by .04 or .05.
- Stop if `integrate.ts` line count after .06 alone is not reduced by ≥600 lines; re-check that all listed functions were moved (not just forwarded).
- Do not start task-2369.15 work (dedup with `rebase-workflow.ts`) in this mission.
