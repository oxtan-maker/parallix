---
id: TASK-2703
title: >-
  Preserve first-review research and restrict Jev to re-reviews
status: done
assignee: [codex]
created_date: '2026-10-09 16:09'
updated_date: '2026-10-10'
labels:
  - ai_sdlc
dependencies: []
priority: high
ordinal: 206008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Operator pivot, 2026-10-10: preserve the research and restore the first-review
blocker without disabling valuable finding or integration-repair re-reviews.

The 30 original first-review subjects exposed unsafe clears, especially
TASK-2569: all mission criteria passed while a broader documentation blocker
correctly prevented historical approval. The major error is clearing a correctly
rejected PR; false returns have a repair/review cost to evaluate in aggregate.

Deliverables:
- Archive full research data and prior mission populations under
  ../parallix-research; retain a compact repository conclusion and archive hashes.
- First reviews go to the general reviewer before evidence collection or Jev
  calls, including shadow mode. Reject first-review classifier verdict application.
- Preserve existing finding-resolution and integration-repair eligibility,
  thresholds, evidence and publication authority.
- Display only re-review classifier statistics and fallback reasons; keep raw
  collection and historical data.
- Verify owning suites, unit headroom, static analysis, docs and an isolated live
  lifecycle showing ordinary first review followed by Jev integration repair.

Research conclusion: backlog/docs/task-2703-first-review-conclusion.md.
Full evidence index: backlog/docs/task-2703-first-review-evidence.json.
Original mission and Backlog intent are retained in the dated conclusion archive.

Out of scope: threshold tuning, new packet constructions, architecture changes,
production first-review adoption, and TASK-2704 mechanical evidence fixes.
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
