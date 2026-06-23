---
event_type: reviewer_findings
timestamp: 2026-06-22T23:21:20.941Z
round: 1
phase: reviewing
actor: qwen
slug: task-1335
---

# Task-1335 Review Findings

## Overview
Reviewed the `mission/task-1335` branch diff against `main` (48 files changed, +881/-1246 lines). Ran `px review task-1335 --verify` which reported `PASS` with 1597 pass / 0 fail.

## Findings

### F1: Deleted task-1324 checkpoint files and tests without migrating coverage
The branch deletes the entire `missions/task-1324/` directory (MISSION.md, CP-1-4.md, review-state.json, review events, implementer artifacts) and removes 4 regression tests from `test/active.test.js` that validated the post-relaunch handoff contract:
- `runHandoffAndReview: relaunch success triggers post-relaunch handoff instead of bare return`
- `runHandoffAndReview: relaunch success must trigger post-relaunch handoff and review loop`
- `runHandoffAndReview: relaunch success with post-relaunch handoff failure must not report success`
- `runHandoffAndReview: relaunch failure must not trigger post-relaunch handoff`

These tests verified that `runHandoffAndReview()` re-invokes `_performHandoff()` after a successful relaunch. The current `active.js` change (line 435) replaces that re-invocation with `return true;` — a direct return after the relaunch log message. This is a behavioral regression relative to the task-1324 fix. The deleted tests were the only coverage of this contract.

**Impact:** Medium. The deleted tests asserted a workflow integrity contract that the current code no longer satisfies.

### F2: Deleted `repairStaleActiveTaskAfterReview` and `commitPersistedReviewOutputs` from review-commands.js
The branch removes 66 lines from `lib/review/review-commands.js`:
- `repairStaleActiveTaskAfterReview()` function (34 lines) — promoted active backlog tasks to `review` after provider-backed approval
- `commitPersistedReviewOutputs()` function (12 lines) — committed persisted review outputs
- Two call sites in `submitReviewRound()` (9 lines + 9 lines)
- One call site in `consumeArtifacts()` (11 lines)

These were the mechanism for the disposition persistence fix. Deleting them while claiming the regression is fixed (CP-2) is contradictory. Either the fix lives elsewhere (need to identify where) or the regression is not actually fixed.

**Impact:** High. The core regression fix mechanism was removed without a visible replacement.

### F3: CP-2 overclaims on disposition persistence coverage
CP-2 states: "The mission's required persisted-disposition cases are explicitly covered in `test/review.test.js` for PUSHBACK_ALL, BLOCKED, PARKED, and CHANGES_MADE." Evidence cites `test/review.test.js:3149-3298`.

The referenced tests (`startReviewLoop persists PUSHBACK_ALL/BLOCKED/PARKED/CHANGES_MADE disposition before returning`) only verify that `writeReviewStateFn` receives the correct disposition value. They do NOT test that the backlog task transitions to `review` status — which was the actual substance of the `startReviewLoop` disposition persistence regression. The deleted task-1324 tests (`submitReviewRound promotes an active backlog task to review after provider-backed approval`) were the ones that tested this.

**Impact:** Medium. The checkpoint cites tests that verify state persistence, not the actual regression behavior.

### F4: review-loop.js reviewer fallback logic changed (out of scope?)
`lib/review/review-loop.js:437-452` adds a single-family fallback path: when no different-family reviewer is runnable but the implementer is, the implementer becomes reviewer with `reviewerSource = 'single-family-fallback'`. Previously, the code would default to `reviewer = 'autonomous'` in all cases where auto-derivation failed.

This is a behavioral change to the review loop that is not part of the publish-path hardening scope. It may be intentional (carried over from task-1324 or another task) but it was not listed in the mission scope.

**Impact:** Low-Medium. Out-of-scope behavioral change bundled into the PR.

### F5: task-1327 checkpoint files also deleted
`missions/task-1327/` (MISSION.md, CP-1-4.md, review-state.json, review events, implementer artifacts) was deleted alongside task-1324. These appear to be cleanup of completed/absorbed missions. No evidence of whether this was planned or accidental.

**Impact:** Low. Likely cleanup, but worth noting.

### F6: Verification proof mocks spread across test files
Shared mocks for `captureVerifiedTreeProof` and `assertVerifiedTreeProof` were added to:
- `test/integrate.test.js:8-26`
- `test/forgejo.test.js:15-31`
- `test/task-1039-integrate.test.js:42-59`
- `test/task-1049-force-push.test.js:15-39` (as per-call stubs)

This is the correct approach — the task-1049 tests use per-call stubs (via `...stubVerifiedTreeProof`) rather than global mocks to avoid leaking into other tests. Good practice.

**Impact:** Positive. Well-considered test architecture.

### F7: New verification.js functions are clean and well-scoped
- `readPublishedTreeState()` — resolves realpath, HEAD commit, HEAD tree hash
- `captureVerifiedTreeProof()` — runs verification gate, checks tree didn't change during execution, emits proof
- `assertVerifiedTreeProof()` — validates proof rootDir, commit, tree against current state

The functions are pure, well-documented, and testable. The proof object contains: rootDir, area, command, commit, tree, verifiedAt.

**Impact:** Positive. Solid implementation.

### F8: Stale-proof tests are well-designed
- `finalizeVariantACloseout rejects a stale verification proof before pushing main closeout` (integrate.test.js) — injects proof with mismatched rootDir, verifies push never runs
- `createPr rejects a verification proof from a different checkout before syncing primary baseline` (forgejo.test.js) — injects proof with mismatched rootDir, verifies push throws

Both tests use `path.resolve('/tmp/different-checkout')` as the stale proof rootDir and verify that `git push` is never called. Clean and effective.

**Impact:** Positive. Good regression coverage.

## Summary
The publish-path hardening (verification.js + integrate.js + forgejo.js guards) is solid. The regression test coverage for stale-proof rejection is good. However, the deletion of the task-1324 review mechanism (`repairStaleActiveTaskAfterReview`, `commitPersistedReviewOutputs`) and its associated tests creates a gap: the disposition persistence regression fix appears to have been removed rather than replaced. The CP-2 checkpoint claims coverage for the disposition persistence fix using tests that only verify state persistence, not the actual backlog task transition that constituted the original regression.

Additionally, a behavioral change to the review loop single-family fallback logic was introduced without clear scope authorization.

---
`[workflow-round:1, workflow-phase:reviewing]`