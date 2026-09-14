---
id: TASK-2503
title: Do not file autobugs when a test run fails (avoid hallucinated format and duplicates)
status: backlog
assignee: []
created_date: '2026-09-13 09:30'
labels:
  - ai_sdlc
dependencies: []
---

## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
When an integration/unit test run fails (e.g. `integration-suite` on `main`), the
pipeline currently files an autobug / mainline-problem task. Two problems make the
output untrustworthy:

1. The filed artifact can be created in a hallucinated format — missing required
   frontmatter, wrong location, or a shape that the backlog tooling does not
   recognize.
2. Repeated failing runs file duplicate tasks (e.g. a new `TASK-MAINGATE-<hash>`
   per run), so the backlog fills with near-identical copies of the same problem.

Symptom observed: `integration-suite` failed on `main` with two failing tests
(`verifyReview handles gate failures` and `repository id from mission worktree path
equals id from primary checkout`). A mainline problem was filed as
`TASK-MAINGATE-2105EA6D`, but the filing behavior itself is unreliable and must
not be trusted until it is fixed.

The fix target: when tests fail, either (a) suppress autobug filing entirely, or
(b) file exactly one deduplicated, correctly-formatted task, idempotently across
repeated runs. Human action is the safe default for mainline regressions.
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Filing path is idempotent: two consecutive failing runs produce at most one task (dedupe by stable key), and the task matches the recognized backlog schema/frontmatter
<!-- DOD:END -->
