# Mission: fix missing review-stage stats recording (task-1347)

## Goal

Fix the missing telemetry stats recording for the reviewing agent in the autonomous review loop by exporting `recordStageStatsSafe` from `lib/review/review.js` so that `lib/commands/active.js` can pass it as `recordStageStatsSafeFn` to `startReviewLoop`.

## Why Now

Every review round produces `review-events/` artifacts but the stats CSV remains silent on review-stage usage. The `draft` stage records stats directly via `stats.recordStageStats()` in `draft.js:952`, and the `active` (execute + follow-up) stages record via `recordStageStatsSafeFn` passed from `active.js:464`. However, `active.js` calls `review.recordStageStatsSafe` which is `undefined` because `lib/review/review.js` imports `recordStageStatsSafe` from `./review-loop` at line 19 but never re-exports it. This means the default noop `() => {}` in `review-loop.js:264` fires for both review and active stages, so review stats are permanently lost. This has been the case since the review-loop refactoring (task-1201) and corrupts the telemetry picture for any mission that goes through review.

## Refinement Signals

- Estimated agent % usage limit: 25-50%
- Confidence: High
- Selection note: defect is a single missing export line; fix is deterministic and fully covered by existing tests
- Main drivers: telemetry integrity, review-loop correctness

## Scope

- Export `recordStageStatsSafe` from `lib/review/review.js` so `active.js:464` receives a real function instead of `undefined`
- Verify that `recordStageStatsSafe` is properly destructured and re-exported alongside the other review-loop exports in review.js
- Confirm the fix works end-to-end: `active.js` → `review.recordStageStatsSafe` → `review-loop.js:startReviewLoop` → `recordStageStatsSafeFn('review', ...)` at line 712 → `stats.accumulateStageStats` → stats CSV row with `stage=review`

## Out of Scope

- Changes to `lib/commands/stats.js` or the stats CSV schema
- Changes to `lib/review/review-loop.js` logic (the recording logic at line 712 is correct; only the wiring was broken)
- Changes to `lib/commands/draft.js` (draft stats already work)
- Changes to `lib/commands/active.js` (the call site is correct; it just received undefined)
- Changes to prompt templates, milestone management, or backlog infrastructure
- Adding new tests (existing test suite already validates review-loop behavior; the missing export is a mechanical fix verified by the full test pass)

## Success Criteria

> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable.

- SC1: `lib/review/review.js` exports `recordStageStatsSafe` as a named property on `module.exports` (verifiable via `require('./lib/review/review').recordStageStatsSafe` returning a function, not undefined)
- SC2: `lib/commands/active.js:464` passes a non-noop function to `startReviewLoop` as `recordStageStatsSafeFn` (verifiable by stepping through the call or inspecting that `review.recordStageStatsSafe` is defined)
- SC3: `review-loop.js` line 712 calls `recordStageStatsSafeFn('review', {...})` which invokes `stats.accumulateStageStats` with `stage='review'` (verifiable by code inspection — no logic change, only wiring fix)
- SC4: All 1640 existing tests pass with zero regressions (verified by `npm test`)
- SC5: The stats CSV for a review-stage invocation contains a row where `stage=review` and the reviewer agent name is populated in the `reviewer_agent` column (verifiable by running a review loop in a test worktree and inspecting the generated stats file)

## Risks and Assumptions

- Risk: None significant — this is a single-line export addition with no logic changes
- Assumption: The existing `recordStageStatsSafe` function in `review-loop.js` is correct and fully tested; only the export was missing
- Assumption: `active.js:464` call site is correct and only needed the missing export — confirmed by code inspection
- Risk: Minimal — if any other module imports `recordStageStatsSafe` from review.js expecting it to be undefined, it would break; this is unlikely as no other caller references it

## Checkpoints

- CP 1: Confirm root cause — `lib/review/review.js` imports `recordStageStatsSafe` from `./review-loop` but does not re-export it, causing `active.js:464` to pass `undefined`
- CP 2: Apply fix — add `module.exports.recordStageStatsSafe = recordStageStatsSafe;` to `lib/review/review.js`
- CP 3: Verify — run `npm test` and confirm all 1640 tests pass with zero regressions

## Gates

- [x] ./scripts/verify-local.sh docs

## Restricted Areas

- Do not modify `lib/commands/stats.js`, `lib/review/review-loop.js`, `lib/commands/draft.js`, or `lib/commands/active.js`
- Do not modify any prompt templates, milestone files, or backlog infrastructure
- Do not add new test files or modify existing tests

## Stop Rules

- Stop after the single export line is added and `npm test` passes
- Stop if any test regression appears (indicates unexpected dependency on the missing export)
- Do not expand scope to investigate historical stats gaps in other stages or missions
