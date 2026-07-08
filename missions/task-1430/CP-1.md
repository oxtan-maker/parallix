# CP-1

Summary of work done:
- Added a `Rebasing Artifacts` subsection to the compact and verbose reviewer prompts so reviewers ignore stale-branch diff noise that parallix will remove during rebase, while still flagging real mission changes.
- Added prompt-builder coverage to assert the new reviewer guidance is present in both prompt variants.

## Goal Check Table

| Check | Evidence |
| --- | --- |
| Review prompt contains explicit rebasing-artifact guidance | `prompts/review.md:19`, `prompts/review.md:23` |
| Verbose review prompt contains equivalent guidance | `prompts/review-verbose.md:21`, `prompts/review-verbose.md:25` |
| Automated coverage asserts the reviewer guidance in both prompt variants | `test/review-prompts.test.js:238` (`review prompts instruct reviewers to ignore rebasing artifacts that are not mission changes (task-1430)`) |
| Focused prompt test suite passed after the change | `node --test test/review-prompts.test.js` |

Next action: complete CP-2 by recording the implementer push-back guidance for rebasing artifacts and keep moving toward the docs and full verification gates.
