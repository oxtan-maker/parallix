---
event_type: reviewer_outcome
timestamp: 2026-06-22T23:21:20.942Z
round: 1
phase: reviewing
actor: qwen
slug: task-1335
verdict: request-changes
---

# Task-1335 Review Outcome

## Mission
Harden parallix self-hosting publish path so broken trees cannot reach main.

## Branch
`mission/task-1335` (commit `a6ac6bfd`)

## Verification
- `px review task-1335 --verify`: PASSED (1597 pass / 0 fail)
- `npm test`: Green (1597 pass / 0 fail, 22 skipped)

## Goal Check Against Mission Success Criteria

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Enumerate every code path that can update standalone main | PASS | CP-1 identifies 3 paths: integrate.js:685-699, integrate.js:1231-1307, forgejo.js:429-441/:727-763 |
| 2 | npm test passes after disposition persistence regression fix | PASS (with caveat) | 1597 pass / 0 fail. Caveat: the tests cited for disposition persistence (CP-2) verify state persistence only, not the backlog task transition that was the original regression. |
| 3 | Each publish path enforces repo-owned verification and fails closed | PASS | integrate.js:685-699, integrate.js:1275-1299, forgejo.js:422-439, forgejo.js:739-753 |
| 4 | Stale or borrowed proof rejected | PASS | verification.js:124-129 checks rootDir, commit, tree; all 3 paths call assertVerifiedTreeProof before publish mutation |
| 5 | Automated test proves broken tree blocked from main | PASS | test/integrate.test.js:1001-1052 (finalizeVariantACloseout stale proof test) |
| 6 | Automated test proves exact-tree binding (green proof from one tree cannot publish another) | PASS | test/forgejo.test.js:102-149 (different checkout root proof rejected) |
| 7 | Provenance loss from squash publication explained | PASS | CP-5 documents why squashed history cannot reconstruct pre-squash verification state, and how the new proof restores forward-looking auditability |

## Findings Summary
- **F1 (Medium):** Deleted task-1324 checkpoint files and 4 regression tests without migrating the post-relaunch handoff contract coverage. Current `active.js:435` returns early after relaunch instead of re-invoking performHandoff.
- **F2 (High):** Removed `repairStaleActiveTaskAfterReview` and `commitPersistedReviewOutputs` from `review-commands.js` — the core disposition persistence fix mechanism — without a visible replacement. Contradicts CP-2's claim that the regression is fixed.
- **F3 (Medium):** CP-2 cites tests that only verify disposition value persistence, not the actual backlog task `active` -> `review` transition that constituted the original regression.
- **F4 (Low-Medium):** Review-loop single-family fallback logic changed (`reviewerSource = 'single-family-fallback'`) — out of scope for publish-path hardening.
- **F5 (Low):** task-1327 checkpoint files also deleted alongside task-1324.
- **F6 (Positive):** Verification proof mocks correctly scoped per-test-file.
- **F7 (Positive):** verification.js functions are clean, pure, and well-documented.
- **F8 (Positive):** Stale-proof regression tests are well-designed with clear assertions.

## Verdict
**request-changes**

The publish-path hardening itself is solid and well-tested. However, the removal of the disposition persistence fix mechanism (`repairStaleActiveTaskAfterReview`, `commitPersistedReviewOutputs`) combined with the deletion of the task-1324 regression tests that covered this same area creates a credibility gap: the mission claims the regression is fixed (SC2, CP-2) but the code that fixed it was deleted without a replacement, and the tests that proved it worked were removed. The reviewer needs to clarify whether the fix lives elsewhere or if this gap needs to be addressed before approval.

The out-of-scope review-loop behavioral change (F4) should also be separated or justified.

---
`[workflow-round:1, workflow-phase:reviewing]`