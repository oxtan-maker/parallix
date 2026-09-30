---
id: TASK-2617
title: Make review --start recover an interrupted handoff automatically
status: backlog
assignee: []
created_date: '2026-09-29 16:36'
labels:
  - bug
dependencies: []
priority: high
ordinal: 145008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
After a verification suite-budget failure exhausted handoff repair, task-2600 remained active with no Review aggregate. px review --continue required an existing review; px review --start rejected the missing aggregate because the mission directory was absent; px review --reconcile-review required the task to be in review and demanded operator-supplied branch, target, agent identities, revision, and eligibility. The recovery path is circular and too manual. Make --start inspect authoritative Mission, backlog, Git, and review data, repair a safely identifiable interrupted handoff and status mismatch, then start review. Keep ambiguous or conflicting evidence fail-closed with one concrete action. Cover the no-mission-directory case and the exhausted verification-repair path.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 From a known mission with no Review aggregate and an active backlog task, px review --start reconstructs safe handoff facts and enters review without manual status editing or reconcile flags.
- [ ] #2 The operation is idempotent, preserves existing review history, and fails with an actionable diagnostic when required facts cannot be established.
- [ ] #3 A regression test reproduces task-2600's active/no-review/no-mission-directory recovery state.
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
