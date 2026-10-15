---
id: TASK-2752
title: Record the reviewed revision on every decided review round
status: done
assignee: [codex]
created_date: '2026-10-15 08:30'
labels:
  - ai_sdlc
  - bug
dependencies: []
priority: medium
ordinal: 242008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`mission_review_rounds.revision` (the round's `subject.revision`) is the mission head when the round starts. The general reviewer often decides on a later head. The review loop already knows that head as `round.verifiedRevision` (`reviewer-phase.ts`, from `preReview.head()`), and the classifier uses it, but the decided round never stores it.

px-0010 checked this on 2026-10-15 (`../parallix-research/px-0010/process-checks/revision-staleness.json`, README section 16). For each round, the stored revision was compared with the `commit_id` of the Forgejo review submitted within 10 minutes of the decision. Of the 461 general-reviewer rounds decided since 2026-10-01 that could be matched, 91 (20%) record a revision whose mission patch differs from the code the reviewer judged, and 64 of them by 20 or more changed lines. Example: task-2742 r3 records `6928e744d`, while the reviewer approved `a9ef38970`, which contains the requested stable-ID fix.

Statistics, process checks (TASK-2742 snapshots) and classifier research that read the round revision therefore attach decisions to the wrong code.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Every review decision, approved or changes-requested, by the general reviewer, classifier or mechanical restoration, persists the exact revision it judged. That is the verified head the reviewer or classifier saw, kept separate from the round-start subject revision.
- [ ] #2 The round-start subject revision keeps its current meaning; existing readers that need it are unchanged.
- [ ] #3 Readers that mean "the decided code" (review history, classifier prior-revision lookup, integration-repair approved revision, stats) use the decided revision.
- [ ] #4 Legacy decided rounds keep a null decided revision. It is never backfilled from the subject revision.
- [ ] #5 A bug-reproduction test in the owning suite shows a round where the head advances after round start: red on main (the decided revision is not stored, or equals the start head), green with the fix.
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
