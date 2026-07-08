# CP-2

Summary of work done:
- Added act-on-review guidance telling implementers to push back on rebasing-artifact findings with a standard `Not a mission change - will be resolved by parallix rebase.` rationale.
- Added prompt-builder coverage to assert the push-back wording is present in both compact and verbose act-on-review prompts.

## Goal Check Table

| Check | Evidence |
| --- | --- |
| Compact act-on-review prompt includes rebasing-artifact push-back guidance | `prompts/act-on-review.md:13`, `prompts/act-on-review.md:14` |
| Verbose act-on-review prompt includes equivalent push-back guidance | `prompts/act-on-review-verbose.md:14`, `prompts/act-on-review-verbose.md:15` |
| Automated coverage asserts the act-on-review guidance in both prompt variants | `test/review-prompts.test.js:333` (`act-on-review prompts provide pushback text for rebasing artifacts (task-1430)`) |
| Focused prompt test suite passed after the change | `node --test test/review-prompts.test.js` |

Next action: run the mission gates in order, capture their results, and write CP-3/CP-4 with final Goal Check evidence.
