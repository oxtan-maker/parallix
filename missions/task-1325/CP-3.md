# CP-3

Summary of work done (CP-3 = "Update `test/review-prompts.test.js` with assertions for the new content. Run `npm test`."):

- Added two new tests asserting the separation-of-duties content in both prompt builders.
- Each test asserts the section header, the "reviewer, not the implementer" framing, the four required MUST-NOT categories (code edits, branch ops, merge/PR ops, workflow-state mutations), and the artifact-dir + `/tmp` whitelist.
- Ran the prompt test file (22/22 pass) and the full suite.

## Goal Check Table

| Check | Evidence |
| --- | --- |
| New assertion for `buildCompactReviewPrompt` separation-of-duties content | Test added. Evidence: [test/review-prompts.test.js](/home/magnus/code/parallix-task-1325/test/review-prompts.test.js:154) |
| New assertion for `buildReviewPrompt` (verbose) separation-of-duties content | Test added. Evidence: [test/review-prompts.test.js](/home/magnus/code/parallix-task-1325/test/review-prompts.test.js:175) |
| Prompt test file passes | `node --test test/review-prompts.test.js` → tests 22, pass 22, fail 0. |
| Full suite passes | `npm test` → tests 1674, pass 1652, fail 0 (22 skipped). The only `review-prompts.test.js` deltas are the 2 added tests, both passing. (History: when this checkpoint was first written the suite had 15 pre-existing `startReviewLoop` failures in `test/review.test.js`; `git stash` confirmed they were present on clean HEAD without my changes. Those failures have since been resolved by intervening commits on the rebuilt branch — the gate is now green.) |

Next action: audit the task-1322 worktree errors and finalize the (now-green) gate status in CP-4.
