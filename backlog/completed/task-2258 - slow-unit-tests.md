---
id: TASK-2258
title: slow unit tests
status: done
assignee: [codex]
created_date: '2026-07-13 13:26'
updated_date: '2026-07-13 13:28'
labels:
  - user_value
dependencies: []
ordinal: 45000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Sometimes unit tests stuck after this:
readReviewState reads from the provided rootDir, not process.cwd() (46.632548ms)
✔ resetReviewState returns unchanged when no state exists (40.457441ms)
✔ resetReviewState removes the state file (46.952553ms)
✔ task-2213: agent performance counts and fix-round averages use only each model row's completed missions (14.443377ms)
✔ task-2213: models sharing an implementer family keep separate rows and averages (0.356753ms)
✔ task-2213: completed rows with missing attribution or review-round metadata are explicit, not silent skew (4.582397ms)
✔ task-2213: completion on the blank-model rollup row keeps the mission in its model row with the rollup fix rounds (0.348344ms)
✔ task-2213: weekly report retains live active-stage spend while excluding that mission from agent performance (8.089972ms)
✔ task-2213: completing implementer fallback is used when its model telemetry is absent (0.257915ms)
✔ task-2213: completing implementer model beats reviewer model in attribution (0.317354ms)
✔ task-2213: completing implementer model beats reviewer model even when reviewer date is later (0.195866ms)
✔ task-2213: the completing implementer owns the model row, not a later reviewer model (0.806715ms)
✔ task-2213: a closed reviewer row does not replace the final implementer after a handoff (0.5795ms)

this seems to be the tests that are the problems

 readReviewState reads from the provided rootDir, not process.cwd() (46.632548ms)
✔ resetReviewState returns unchanged when no state exists (40.457441ms)
✔ resetReviewState removes the state file (46.952553ms)
✔ task-2213: agent performance counts and fix-round averages use only each model row's completed missions (14.443377ms)
✔ task-2213: models sharing an implementer family keep separate rows and averages (0.356753ms)
✔ task-2213: completed rows with missing attribution or review-round metadata are explicit, not silent skew (4.582397ms)
✔ task-2213: completion on the blank-model rollup row keeps the mission in its model row with the rollup fix rounds (0.348344ms)
✔ task-2213: weekly report retains live active-stage spend while excluding that mission from agent performance (8.089972ms)
✔ task-2213: completing implementer fallback is used when its model telemetry is absent (0.257915ms)
✔ task-2213: completing implementer model beats reviewer model in attribution (0.317354ms)
✔ task-2213: completing implementer model beats reviewer model even when reviewer date is later (0.195866ms)
✔ task-2213: the completing implementer owns the model row, not a later reviewer model (0.806715ms)
✔ task-2213: a closed reviewer row does not replace the final implementer after a handoff (0.5795ms)
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
