---
id: TASK-2514
title: Allow human review approval after active-state repair
status: backlog
assignee: []
created_date: '2026-09-14 14:20'
labels:
  - review
  - lifecycle
  - human-override
dependencies: []
references:
  - src/adapters/review/review-commands.ts
  - src/adapters/review/review-round.ts
priority: high
ordinal: 80007
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
After an interrupted review with requested changes has been repaired manually, a human needs one supported command path to move the valid next review round from active back to review and record an approval. Preserve the review aggregate: approval must never overwrite unresolved findings in an awaiting-implementation round.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A named human can use px review --submit-review approve for a valid awaiting-review round even when the mission lane is active after repair.
- [ ] #2 The command repairs only the lifecycle lane needed for that valid round; it does not create a second review state machine.
- [ ] #3 An approve while review is awaiting-implementation still fails and leaves the changes-requested decision and findings intact.
- [ ] #4 Coverage exercises active + awaiting-review human approval and rejects active + awaiting-implementation approval.
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
