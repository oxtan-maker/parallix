# Mission: Fix draft stats recording for feature-branch missions (wrong rootDir) (task-1352)

## Goal

Make `recordDraftStats` resolve the backlog task from the mission worktree (`targetWorktree`) instead of `mainRepo`, so that draft stage telemetry (provider, model, tokens, tool_calls, duration) is recorded for feature-branch missions where the task file exists only in the worktree.

## Why Now

Every feature-branch mission loses draft-stage telemetry silently — the draft completes and the task transitions to `refined`, but provider/model/tokens/tool_calls/duration are never recorded. This creates a systematic blind spot in mission analytics: all draft-stage rows in `data/stats.csv` have zero or missing fields for feature-branch missions. The same class of defect was already noticed and fixed for the draft preflight task lookup; applying the same pattern to stats closes the gap.

## Refinement Signals

- Estimated agent % usage limit: 25-50%
- Confidence: High
- Selection note: activate as-is
- Main drivers: telemetry gap (every feature-branch mission drops draft stats), code consistency (review/active stages already use worktree rootDir), low-risk targeted fix with existing pattern.

## Scope

- `lib/commands/draft.js`: inject `recordDraftStats` as `recordDraftStatsFn`, call it with `rootDir: targetWorktree` (matching how `resolveTaskFileFn`, `enforceDraftCommitSafetyFn`, and `validateDraftClassificationFn` already receive the worktree).
- `lib/commands/stats.js`: no changes to function signatures; the fix is purely at the call site in `draft.js`.
- `test/draft-command.test.js`: add a regression assertion that `recordDraftStatsFn` is invoked with `rootDir` equal to the worktree path (not `mainRepo`).

## Out of Scope

- Changes to `lib/commands/stats.js` internal logic (`resolveMissionClassification`, `recordStageStats`, `accumulateStageStats`).
- Changes to stats schema, CSV format, or downstream consumers.
- Fixes for other stages (review, active, etc.) — they already use the worktree rootDir.
- Integration/e2e tests; unit test coverage is sufficient for this narrowly scoped fix.

## Success Criteria

> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable.

1. `lib/commands/draft.js` passes `rootDir: targetWorktree` (not `rootDir: mainRepo`) to `recordDraftStatsFn` at the call site around line 312-319.
2. `test/draft-command.test.js` asserts that `recordDraftStatsFn` is called with `opts.rootDir` equal to the worktree variable (not `tmpRoot/main`).
3. `npm test` (all tests in `test/*.test.js`) passes cleanly with no regressions.
4. No changes to `lib/commands/stats.js` function definitions or exported APIs.

## Risks and Assumptions

- **Assumption:** `targetWorktree` is always set by the time `recordDraftStatsFn` is called. It is — the worktree is created before any stats recording in the draft flow.
- **Risk:** If a primary-branch mission (no separate worktree) somehow passes a different rootDir, stats resolution could break. Mitigation: primary-branch missions use `targetWorktree === mainRepo` path semantics, so `resolveTaskFile` still finds the task. Verified by the existing test suite.
- **Risk:** The fix is narrowly scoped to one call site; no cascading changes expected.

## Checkpoints

- CP 1: Draft complete — mission contract reviewed, code changes minimal (one call-site fix + one test assertion), all tests green.

## Gates

- [ ] ./scripts/verify-local.sh docs

## Restricted Areas

- Do not modify `lib/commands/stats.js` internals (`resolveMissionClassification`, `recordStageStats`, `accumulateStageStats`).
- Do not change stats schema, CSV column layout, or file paths.
- Do not touch any other command files (`review.js`, `active.js`, `integrate.js`).

## Stop Rules

- If `npm test` reveals a regression in any test unrelated to `draft-command.test.js`, stop and report — do not attempt to fix unrelated failures.
- If the fix requires changes beyond `draft.js` (one call-site) and `draft-command.test.js` (one assertion), stop and escalate — the scope has expanded.
- If `resolveTaskFile` behavior differs between primary and feature branches in an unexpected way, stop and investigate before proceeding.
