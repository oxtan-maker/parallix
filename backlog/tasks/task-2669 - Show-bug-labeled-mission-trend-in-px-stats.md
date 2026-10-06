---
id: TASK-2669
title: Show bug-labeled mission trend in px stats
status: backlog
assignee: []
created_date: '2026-10-06 13:52'
labels:
  - ai_sdlc
dependencies: []
priority: medium
ordinal: 184008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The operator needs a standing signal for whether Parallix is converging: the share of delivery effort spent fixing bugs should fall over time as guards and rules accumulate. AGENTS.md and the operator memory record a growing set of incident-driven rules and known flakes; without a visible bug trend it is not possible to tell from the data whether those rules are reducing defects or only accumulating.

Missions already carry a `bug` label in Mission state (see `src/domain/mission-workflow.ts`, which requires a reproduction test for bug-labeled missions), separate from the single classification value (`ai_sdlc`, `user_value`, `unknown`). `px stats` reports by classification but does not show bug-labeled missions as their own series.

The outcome is that `px stats` shows, per full UTC ISO week, how many completed missions were bug-labeled and their share of all completed missions, alongside the existing weekly view, so the operator can see at a glance whether bug work is trending down. Bug label and classification are independent: a bug mission is still counted under its classification.

Read labels from authoritative Mission state through the existing statistics path, never from Backlog task file labels (see TASK-2601 for the authority rule).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 px stats reports, per full UTC ISO week, the count of completed bug-labeled missions and their share of all completed missions
- [ ] #2 The report shows a direction over the reporting window (for example a trailing average) so convergence or regression is visible without manual calculation
- [ ] #3 Bug-labeled missions are still counted under their classification; the bug series is additive, not a replacement classification
- [ ] #4 Bug labels are read from Mission state; a Backlog task label alone never adds or removes a mission from the bug series
- [ ] #5 Weeks with no completed missions are shown explicitly rather than omitted or reported as 0% bug share
- [ ] #6 The owning stats suite covers mixed bug and non-bug weeks, an empty week, and a bug mission whose Backlog file lacks the label
- [ ] #7 docs describing px stats output are updated
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
