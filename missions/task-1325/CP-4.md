# CP-4

Summary of work done (CP-4 = "Audit worktree errors from task-1322 logs. Decide whether prompt-level notes are warranted or if worktree issues belong in a separate backlog observation."):

## Worktree / task-1322 audit

The mission's "Why Now" cited worktree-related errors during task-1322's review. Reading the task-1322 review-event logs shows the actual failure mode:

- The qwen reviewer agent **crashed (exit 1, ~15.8s)** during round 1.
- The mistral fallback failed with **"Invalid API key"**, exhausting eligible agents.
- `review-state.json` was left at `phase: reviewing`, `disposition: null` — an incomplete cycle.
- The live anecdote that motivated the task was the reviewer **"going ballistic" and acting as the implementer**.

Evidence: [missions/task-1322/review-events/2026-06-17T043845-reviewer_findings-1-qwen.md](/home/magnus/code/parallix-task-1325/missions/task-1322/review-events/2026-06-17T043845-reviewer_findings-1-qwen.md), [missions/task-1322/review-events/2026-06-17T043845-reviewer_outcome-1-qwen.md](/home/magnus/code/parallix-task-1325/missions/task-1322/review-events/2026-06-17T043845-reviewer_outcome-1-qwen.md).

**Decision:** The task-1322 problems were agent-runtime issues (crash, bad API key) plus reviewer-overreach behavior — **not** a worktree-state bug. The mission's Assumption ("worktree issues observed in task-1322 are environmental rather than prompt-caused") holds. Therefore **no worktree-specific note is added to the prompts**; the prompt remedy is the separation-of-duties section that directly addresses the overreach. The `./scripts/verify-local.sh docs` gate referenced in MISSION.md does not exist in this repo — the configured verification command is `npm test` (`workflow.config.json` → `adapters.verification.command`), consistent with task-1322's CP-4 and task-1311's review accepting `npm test` as the substitute.

## Pre-existing test regression (resolved upstream)

When this mission was first executed, `npm test` reported **15 failing `startReviewLoop` tests** in `test/review.test.js`. They were pre-existing and unrelated to this task (`test/review.test.js` and `lib/review/review-loop.js` were byte-identical to `main`; `git stash` confirmed the failures persisted without my changes), so — `lib/review/review-loop.js` being a **Restricted Area** for this mission — they were not fixed here but filed as **TASK-1333**.

**Update (round 1, current state):** After the branch was rebuilt on a newer local main, the full suite is **green: `npm test` → tests 1674, pass 1652, fail 0 (22 skipped)**. The 15 failures were resolved by intervening work on the rebuilt branch. TASK-1333 was committed and has since been **archived** (`backlog/archive/tasks/task-1333 - Fix-15-pre-existing-startReviewLoop-test-failures-in-review.test.js.md`); it is no longer an active blocker. The task-1325 deliverable itself never introduced any failure.

## Goal Check

| # | Success Criterion | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Compact prompt has Separation-of-Duties section with ≥5 MUST-NOT items (code edits, branch ops, PR ops, state mutations, merge/squash) | PASS | [prompts/review.md](/home/magnus/code/parallix-task-1325/prompts/review.md:18) (header), [prompts/review.md](/home/magnus/code/parallix-task-1325/prompts/review.md:21) (code edits), [prompts/review.md](/home/magnus/code/parallix-task-1325/prompts/review.md:23) (branch ops incl. squash/reset), [prompts/review.md](/home/magnus/code/parallix-task-1325/prompts/review.md:24) (merge/PR), [prompts/review.md](/home/magnus/code/parallix-task-1325/prompts/review.md:25) (state mutations) |
| 2 | Verbose prompt contains matching separation-of-duties language | PASS | [prompts/review-verbose.md](/home/magnus/code/parallix-task-1325/prompts/review-verbose.md:21), [prompts/review-verbose.md](/home/magnus/code/parallix-task-1325/prompts/review-verbose.md:26), [prompts/review-verbose.md](/home/magnus/code/parallix-task-1325/prompts/review-verbose.md:28) |
| 3 | Both prompts permit writing to `{{artifactDir}}` and `/tmp` as sole exceptions | PASS | [prompts/review.md](/home/magnus/code/parallix-task-1325/prompts/review.md:27) (MAY block), [prompts/review.md](/home/magnus/code/parallix-task-1325/prompts/review.md:28), [prompts/review-verbose.md](/home/magnus/code/parallix-task-1325/prompts/review-verbose.md:30), [prompts/review-verbose.md](/home/magnus/code/parallix-task-1325/prompts/review-verbose.md:31) |
| 4 | Both prompts retain all existing minimum-loop-contract bullets | PASS | [prompts/review.md](/home/magnus/code/parallix-task-1325/prompts/review.md:7), [prompts/review.md](/home/magnus/code/parallix-task-1325/prompts/review.md:14) (Forgejo bullet), [prompts/review-verbose.md](/home/magnus/code/parallix-task-1325/prompts/review-verbose.md:11) |
| 5 | All existing tests pass via `npm test` | PASS | `npm test` → tests 1674, pass 1652, fail 0 (22 skipped). (Was 15 pre-existing `startReviewLoop` failures at first execution; resolved upstream — see "Pre-existing test regression" above.) |
| 6 | ≥2 new assertions verify separation-of-duties content from `buildCompactReviewPrompt` and `buildReviewPrompt` | PASS | [test/review-prompts.test.js](/home/magnus/code/parallix-task-1325/test/review-prompts.test.js:154), [test/review-prompts.test.js](/home/magnus/code/parallix-task-1325/test/review-prompts.test.js:175); `node --test test/review-prompts.test.js` → 22/22 pass |

## Gate status

- **`npm test` (configured verification, area `all`/`docs`):** PASS — tests 1674, pass 1652, fail 0 (22 skipped). The earlier pre-existing `startReviewLoop` failures were resolved upstream on the rebuilt branch.
- The `./scripts/verify-local.sh docs` gate named in MISSION.md does not exist in this repo; `npm test` is the configured verification (`workflow.config.json` → `adapters.verification.command`), consistent with prior reviews.

## Round 1 act-on-review resolution

Reviewer (qwen) verdict round 1: **request-changes**. Disposition: **CHANGES_MADE**. Resolution:

- **Finding 3 (Medium, stale test claims):** FIXED — CP-3/CP-4 updated to the current green state (1674/1652/0).
- **Finding 5 (Medium, TASK-1349 deletion):** FIXED — restored `backlog/tasks/task-1349 …md` from `main`; the deletion was an accidental artifact of the branch rebuild, never intended by this mission.
- **Findings 1, 6, 7 (Low, review.md scope creep / Check: section / graphify removal):** FIXED — `prompts/review.md` reverted to `main` + the separation-of-duties section only; the restructuring (and graphify-bullet removal) had leaked in during the rebuild and is no longer part of this PR. The graphify-first bullet is preserved.
- **Finding 2 (Low, verbose duplicate MUST):** FIXED — dropped the redundant `You MUST:` block from both prompts; the existing `Requirements:`/`Minimum loop contract` bullets already enumerate reviewer obligations. The novel `You MUST NOT:` and `You MAY:` blocks remain.
- **Finding 4 (Low, TASK-1333 archival not noted):** FIXED — CP-4 now records that TASK-1333 was filed and subsequently archived after the failures were resolved.
- **Finding 8 (Info, qwen reviewer):** ACK — no action; this is a reviewer-selection meta-observation, not a defect in the deliverable.

Next action: gate is green and all round-1 findings addressed; commit and hand back to the review loop.
