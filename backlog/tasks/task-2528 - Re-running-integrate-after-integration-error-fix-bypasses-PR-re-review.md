---
id: TASK-2528
title: Re-running integrate after an integration-error fix bypasses PR re-review of the changed code
status: active
assignee: [codex]
created_date: '2026-09-16 13:05'
labels: [bug, ai_sdlc, trust]
dependencies: []
references:
  - src/adapters/cli/commands/integrate-gate-rebound.ts
  - backlog/completed/task-2507 - Stop-integration-failure-handling-from-mutating-main-or-inventing-backlog-IDs.md
  - backlog/archive/tasks/task-1281 - Guard-against-hallucinated-review-state-in-parallix-act-on-review.md
ordinal: 74026
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A mission went through review, an approved PR was created, and `px integrate`
was run. The integration gate failed with an integration error. The
implementer fixed the failing change in the mission worktree, and the workflow
then tried to run `integrate` again on the same, already-approved PR.

This is wrong. Once the implementer edits the mission after a gate failure, the
diff that the reviewer approved is no longer the diff being integrated.
Re-running integrate on a now-changed, already-approved PR re-lands code that
was never reviewed in its final form — the exact trust gap TASK-1281 exists to
close. The correct recovery after an integration-error fix is to invalidate the
approved PR (request changes / clear the approval) and send the mission back to
review, so the reviewer re-approves the actual landed diff.

The failure mode is a gap in the post-failure recovery path: fixing the gate
error and re-running integrate is treated as a continuation of the same
approved review, when it should be treated as a new revision that invalidates
the prior approval. See TASK-2507 for the related guardrail that integration
failure handling must never mutate main or fabricate state — here the harm is
softer (a stale approval is silently carried forward), but it is the same class
of failure: integration failure handling advancing workflow state without a
truthful re-review step.

## Non-regression constraints (must not break)
<!-- NONREG:BEGIN -->
- Do NOT weaken the integration gate itself, its gate selection, or the
  pre-landing integration guard (TASK-2517).
- Do NOT remove integration-error evidence capture or the bounded gate-rebound
  retries introduced by TASK-2492 / TASK-2507.
- Do NOT change landing behavior for a genuinely unchanged re-run (a re-run that
  produces no diff since the approval should still land without a needless
  re-review).
<!-- NONREG:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 After an integration-error fix that changes the mission diff, the
  approved PR is invalidated (approval cleared / changes requested) before any
  re-run of integrate
- [ ] #2 The mission is routed back to review so the reviewer re-approves the
  actual landed diff; integrate does not land on a stale approval
- [ ] #3 A re-run that changes nothing since the approval still lands without
  forcing an unnecessary re-review
- [ ] #4 Coverage proves that a changed post-failure re-run cannot land on a
  prior approval
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof
  rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests introduced (no .only, no bare
  .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line
  references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that
  fails before the fix and passes after
<!-- DOD:END -->
