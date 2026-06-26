# CP-1

> **Course correction note:** Earlier CP-1/CP-2 drafts (committed in eedfa67b/46275897) pursued a code-based `detectAndRecoverReviewerOverreach` helper in `lib/review/review-loop.js`. That approach was off-mission: MISSION.md scopes this task to **prompt-text changes only** and explicitly lists `lib/review/review-loop.js` as a Restricted Area. No such helper ever existed in the tree (`grep detectAndRecoverReviewerOverreach lib/ test/` returns nothing). These checkpoints were rewritten to execute the mission as actually specified.

Summary of work done (CP-1 = "Read the current review prompts, the task-1322 review logs, and all related prompt tests; document the exact prompt lines that caused ambiguity."):

- Read both review prompt templates and the prompt builders/tests.
- Read the task-1322 reviewer logs that motivated this task.
- Pinned the exact terse lines that let a reviewer agent conflate review with implementation.

## Goal Check Table

| Check | Evidence |
| --- | --- |
| Identified the ambiguous constraint in the compact prompt | The only guard was a single terse line: `Do not edit repo files; do not switch into implementer behavior.` — no enumeration of branch/PR/merge/state operations, no whitelisted exceptions. Evidence: `prompts/review.md` (pre-change line 15, since replaced) |
| Identified the ambiguous constraint in the verbose prompt | Same terseness: a bare `do not edit repo files` bullet with no enumerated boundaries. Evidence: `prompts/review-verbose.md` (pre-change line 19, since replaced) |
| Confirmed task-1322 motivation was reviewer-overreach, not a worktree bug | task-1322 round 1: qwen reviewer crashed (exit 1), mistral fallback hit "Invalid API key"; the live anecdote was the reviewer "going ballistic" / acting as implementer. Evidence: [missions/task-1322/review-events/2026-06-17T043845-reviewer_findings-1-qwen.md](/home/magnus/code/parallix-task-1325/missions/task-1322/review-events/2026-06-17T043845-reviewer_findings-1-qwen.md), [missions/task-1322/review-events/2026-06-17T043845-reviewer_outcome-1-qwen.md](/home/magnus/code/parallix-task-1325/missions/task-1322/review-events/2026-06-17T043845-reviewer_outcome-1-qwen.md) |
| Located the prompt builders and the assertion test that must be updated | `buildCompactReviewPrompt` (review.md) and `buildReviewPrompt` (review-verbose.md) feed the loop; `test/review-prompts.test.js` asserts prompt content. Evidence: [lib/review/review-prompts.js](/home/magnus/code/parallix-task-1325/lib/review/review-prompts.js:149), [lib/review/review-prompts.js](/home/magnus/code/parallix-task-1325/lib/review/review-prompts.js:78), [test/review-prompts.test.js](/home/magnus/code/parallix-task-1325/test/review-prompts.test.js:114) |
| Tests run for CP-1 | None; CP-1 is read/analysis only. |

Next action: draft a "Separation of duties" section in `prompts/review.md` enumerating ≥5 MUST-NOT items (code edits, branch ops, PR ops, merge/squash, workflow-state mutations) plus the artifact-dir/`/tmp` whitelist, and mirror it in `prompts/review-verbose.md`.
