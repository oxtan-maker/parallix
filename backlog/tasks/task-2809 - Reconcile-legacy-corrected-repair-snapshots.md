---
id: TASK-2809
title: Reconcile legacy corrected repair snapshots
status: backlog
assignee: []
created_date: '2026-10-22 12:27'
labels:
  - bug
  - workflow
dependencies: []
priority: high
ordinal: 288008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
When an operator correction has already cleared repair.blocker under the earlier command, but its authorizedCriteria snapshot remains stale, handoff remains blocked with repair-contract-changed and correct-invalid-contract rejects replay because it requires an unresolved blocker. Add a focused parent-red reproduction from a persisted legacy corrected repair: changed mission criteria, correction history retained, no repair.blocker; handoff must report stale authority today. Fixed-green: a direct authorized operator reconciliation (or deterministic safe migration) refreshes only the current criteria snapshot while retaining original blocker, correction decision/evidence, gates, incident identity, version checks, capability checks and all history. It must not create authority automatically, bypass review/gates, or alter unrelated repairs. Acceptance: task-2807's documented state can progress through normal handoff after its recorded operator correction; unauthorized/nested/stale/invalid references remain rejected; test lives in repair checkpoint owner suite.
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
