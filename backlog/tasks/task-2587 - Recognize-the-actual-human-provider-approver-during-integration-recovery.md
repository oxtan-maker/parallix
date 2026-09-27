---
id: TASK-2587
title: Recognize the actual human provider approver during integration recovery
status: backlog
assignee: []
created_date: '2026-09-27 06:03'
labels:
  - bug
  - review
  - integration
dependencies: []
references:
  - TASK-2582
  - TASK-2514
priority: high
ordinal: 118008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Incident: TASK-2521.07, PR #507, 2026-09-27. px status version 62 reports Mission active, review round 2 phase approved, disposition BLOCKED, approvalOwed=true, no outstanding findings. px integrate refuses with stored approval without required provider approval. Forgejo GET /pulls/507/reviews already contains APPROVED review #2367 by magnus on commit e3d1f703dd293154037f2a8340991239d4a080ec. The local round records revision handoff-1790428388401 rather than a commit; current HEAD e472e6020d3cba7fec111473895030bada1e3787 differs only in task bookkeeping from provider head 8a6f522165ee2940918e118c406b66e37792d3c3.

Root cause: src/adapters/forgejo/forgejo-pr.ts reviewDecisionFromReviews recognizes DEFAULT_FORGEJO_USER=human or the assigned reviewer=codex as approval authority; the real operator account magnus is neither. Setting FORGEJO_USER=magnus changes authentication but not the hard-coded approval identity. The actual human approval is discarded for recovery. Related lifecycle active+approved defect is already TASK-2582; manual lane repair is TASK-2514. Those do not cover this identity mismatch.

Also px integrate --dry-run prints preflight passed / READY TO INTEGRATE despite the real recovery rejection because approval.ts recoveryEstablishesApproval trusts the stored decision while recovery.ts recoverActiveMission requires provider corroboration. Ensure both paths use one approval policy. Preserve unresolved-finding, retraction, revision and provider authorization guards; do not trust arbitrary approvals or bypass gates. Audit the approved+BLOCKED flat-state mapping so blocker writes cannot manufacture or corrupt approval decisions; preserve historical review evidence.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Configured authorized human operator approval qualifies even when provider login differs from the human alias; authentication overrides alone never confer approval authority.
- [ ] #2 Dry run and real integration agree on recovery authority and report missing qualifying provider approval accurately.
- [ ] #3 Regression coverage reproduces magnus approval with assigned reviewer codex and default alias human; negative cases reject unauthorized, withdrawn and invalid revision approvals.
- [ ] #4 Approved plus BLOCKED state remains recoverable without inventing findings, deleting review history, direct SQL edits or bypassing required gates.
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
