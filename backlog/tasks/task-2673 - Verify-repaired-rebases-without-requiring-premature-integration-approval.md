---
id: TASK-2673
title: Verify repaired rebases without requiring premature integration approval
status: backlog
assignee: []
created_date: '2026-10-06 18:41'
labels:
  - bug
dependencies: []
priority: high
ordinal: 187008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Observed 2026-10-06 at 17:35-17:38 UTC on TASK-2670: conflict resolution completed the Git rebase and docs verification, then its mandated px integrate task-2670 --dry-run failed because the mission was active and had no current APPROVED review. The resolver reported that required verification failure. The conflict-resolution workflow itself moves the mission to active before repair; integration readiness is therefore not a valid unconditional proof that a repaired rebase succeeded.

Make post-rebase verification appropriate to the mission lifecycle and repaired tree. Verify actual Git completion and repository checks without requiring integration eligibility for an active mission. Keep review/approval restoration or invalidation under the existing authoritative lifecycle services; modified code still needs fresh independent review when required. Do not bypass integration preflight, fabricate approval, promote an unapproved mission, or restore approval merely to satisfy the dry-run.

Relevant authority: src/application/rebase-workflow.ts (buildRebasePrompt, launchConflictResolver, finishRebase) and the rebase workflow adapter. Retained evidence: .workflow/run-history/task-2670/execute-codex-a1-muwymia8/stdout/000000000000.log in the TASK-2670 worktree. Related completed TASK-2582 establishes repair/return lifecycle behavior and TASK-2587 approval recognition; preserve those contracts. Any change to authority or architectural boundaries requires the explicit architectural decision mandated by AGENTS.md.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Retain a focused red-to-green reproduction in the owning rebase/lifecycle suite for an active mission whose rebase and repository checks succeed but which lacks integration approval.
- [ ] #2 Conflict-resolution guidance and completion checks verify the rebased tree without unconditionally invoking integration eligibility checks that require an approved mission.
- [ ] #3 Lifecycle return and approval coverage remain authoritative: changed repairs require the appropriate review, and actual integration continues to reject active or unapproved missions.
- [ ] #4 Focused regressions cover repository verification failure, unfinished rebase and approval preservation/invalidation; run required static analysis and docs verification if live guidance changes.
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
