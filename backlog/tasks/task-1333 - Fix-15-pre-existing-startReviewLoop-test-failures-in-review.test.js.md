---
id: TASK-1333
title: Fix 15 pre-existing startReviewLoop test failures in review.test.js
status: backlog
assignee: []
created_date: '2026-06-22 16:21'
updated_date: '2026-06-23 16:37'
labels:
  - bug
  - review-loop
  - tests
dependencies: []
priority: high
ordinal: 49000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Description

`npm test` currently reports 15 failing tests, all `startReviewLoop ...` cases in `test/review.test.js`. These failures are pre-existing and unrelated to task-1325 (the prompt-clarity change): `test/review.test.js` and `lib/review/review-loop.js` are byte-identical to `main`, and the failures reproduce on a clean checkout.

### Evidence the failures are a regression
- task-1322's reviewer outcome (2026-06-17, `missions/task-1322/review-events/2026-06-17T043845-reviewer_outcome-1-qwen.md`) recorded `npm test -> pass 1566, fail 0`. The failures were introduced after that date by a later mission (review.test.js / review-loop.js last touched by mission/task-1303 and mission/task-1311).

### Symptom
The review loop exits after the first reviewer round instead of progressing through act-on-review and a second round. Example (`test/review.test.js:762` "startReviewLoop rebases immediately before each reviewer round"):

- actual:   ['rebase', 'review:reviewer']
- expected: ['rebase', 'review:reviewer', 'act-on-review:implementer', 'rebase', 'review:reviewer']

All 15 failures share this "loop terminates early / disposition never persisted" shape (disposition asserts return `null` instead of PARKED / CHANGES_MADE / PUSHBACK_ALL / BLOCKED).

### Failing tests
startReviewLoop: full loop success and exit cases; rebases immediately before each reviewer round; continue consumes existing fixing disposition before next reviewer round; isContinue waits long enough for delayed existing fixing disposition; continue reviewing phase skips only when existing review is found; handles reviewer polling timeout with recovery; persists reviewer retry count before recovery relaunch; persists implementer retry count before recovery relaunch; does not crash with ReferenceError when taskResolution is used in loop body; passes taskResolution to applyAgentFallback for both reviewer and implementer; repairs a persisted rewiewing typo and resumes on the reviewer path; persists PUSHBACK_ALL/BLOCKED/PARKED disposition before returning; persists CHANGES_MADE disposition before continuing.

### Why this matters
These failures block the `npm test` verification gate for every mission on this branch, including task-1325. The task-1325 mission gate ("npm test - zero failures") cannot pass until this regression is fixed.

## Acceptance Criteria
- Root-cause the early loop termination in `lib/review/review-loop.js` (or the test harness mock that simulates it).
- `npm test` reports 0 failures.
- A regression test or git-bisect note identifies which mission introduced the break.
<!-- SECTION:DESCRIPTION:END -->
