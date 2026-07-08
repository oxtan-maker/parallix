# CP-4

Summary of work done:
- Completed the reviewer and act-on-review prompt updates so rebasing artifacts are explicitly treated as non-findings unless the mission actually introduced the change.
- Added prompt-builder tests covering both reviewer guidance and implementer push-back guidance.
- Re-verified the mission-owned prompt work and captured that the remaining red full-suite failure is outside the task-1430 diff: `git diff 93e4d4010748bdcf831054cbf81615b2a1539428..HEAD -- px.ts test/px-runtime-smoke.test.js` is empty.

## Goal Check

| Goal Check description | Evidence | Status |
| --- | --- | --- |
| Review prompts explicitly instruct reviewers to ignore stale-branch diff noise that will be resolved by parallix rebase | `prompts/review.md:19`, `prompts/review.md:23`, `prompts/review-verbose.md:21`, `prompts/review-verbose.md:25` | PASS |
| Act-on-review prompts explicitly instruct implementers to push back on rebasing-artifact findings as not mission changes | `prompts/act-on-review.md:14`, `prompts/act-on-review-verbose.md:15` | PASS |
| Prompt builders are covered by automated assertions for the new reviewer guidance | `test/review-prompts.test.js:238` (`review prompts instruct reviewers to ignore rebasing artifacts that are not mission changes (task-1430)`) | PASS |
| Prompt builders are covered by automated assertions for the new implementer push-back guidance | `test/review-prompts.test.js:333` (`act-on-review prompts provide pushback text for rebasing artifacts (task-1430)`) | PASS |
| Mission docs gate passed | `./scripts/verify-local.sh docs` (`PASS: all required documentation present`) — re-verified on 2026-07-07 during round-4 follow-up | PASS |
| Mission test checkpoint passed with zero failures in this environment | `npm test` currently exits `1` with `pass 2009`, `fail 1`, `skipped 22`; the failing test is `test/px-runtime-smoke.test.js` (`ERR_UNKNOWN_FILE_EXTENSION` for `px.ts`). `git diff 93e4d4010748bdcf831054cbf81615b2a1539428..HEAD -- px.ts test/px-runtime-smoke.test.js` is empty, so this red gate is not introduced by the task-1430 prompt changes. | FAIL |
| Required broad verification gate passed | `./scripts/verify-local.sh all` currently exits `1` with the same `test/px-runtime-smoke.test.js` failure; the mission-owned prompt suite still passes independently via `node --test test/review-prompts.test.js`. | FAIL |
| Mission-owned focused suite passed | `node --test test/review-prompts.test.js` (`pass 26`, `fail 0`) | PASS |

Next action: hand off with the corrected checkpoint evidence and push back on treating the unrelated `px` runtime smoke failure as a task-1430 regression; the stop rule for this mission says regressions not present in the mission's own diff should be investigated and excluded from scope rather than fixed here.
