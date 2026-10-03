---
id: TASK-2630
title: >-
  Integration must recover rejected squash payloads and re-review unapproved
  changes
status: done
assignee: [codex]
created_date: '2026-10-02 07:10'
labels:
  - bug
dependencies: []
priority: high
ordinal: 152008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-2622.08 passed all 10 integration gates, then local squash landing rejected test/lib/test-categories.ts and test/lib/test-tier-selection.ts as different from the gated mission tip. Main advanced from 3bf142da1 to 283a68366 after the mission rebase; the clean three-way squash retained newer main test registrations, correctly differing from the older gated tip. The rejection left 85 payload paths staged on main. The finally block restored the unrelated TASK-2622.20 edit but did not remove the rejected squash, so retry failed with overlapping dirty paths. Main HEAD did not move. Recovery preserved the entire failed checkout in a named stash before removing the abandoned squash. Approval was also still accepted despite subsequent implementation commits and an unreadable approved revision 3aff1a45f. Fix the lifecycle as one recoverable transaction: pin and recheck the base and gated mission revisions at landing; if the base moves, rebase and re-gate rather than compare an ungated merge tree against an older mission tip or drop newer base changes. On every pre-commit rejection, undo only integration-owned changes before restoring unrelated local work; preserve data and diagnose cleanup failure. Restart review for actual unapproved implementation or conflict-resolution changes; preserve approval for a demonstrably equivalent clean rebase and recognized bookkeeping. Do not silently accept unknown approval coverage. Keep a committed landing intact for resumable closeout. Extend the existing squash landing and approval/rebase owning contracts, without new task-local duplicate suites.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Payload mismatch and staged tier-guard rejection leave main HEAD unchanged and remove abandoned integration index/worktree changes, with unrelated local edits restored exactly; retry is possible.
- [ ] #2 Base movement after gates triggers a rebase and gates on the actual landing candidate, retaining newer main changes.
- [ ] #3 Unapproved implementation changes restart independent review; equivalent rebases and recognized bookkeeping retain valid approval.
- [ ] #4 Unreadable approval revisions cannot silently authorize an unapproved payload; provide actionable recovery.
- [ ] #5 Focused red-to-green regression cases live in existing owning suites; static analysis passes.
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
