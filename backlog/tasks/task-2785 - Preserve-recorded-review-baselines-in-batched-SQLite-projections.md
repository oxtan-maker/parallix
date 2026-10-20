---
id: TASK-2785
title: Preserve recorded review baselines in batched SQLite projections
status: backlog
assignee: []
created_date: '2026-10-19 09:55'
labels: []
dependencies: []
ordinal: 266008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Include review_baseline in the batched review reader and give its repeated review-round SELECT columns one minimal owner shared with the full Mission loader.

Context:
Preserve ADRs 0051 and 0053. TASK-2401 introduced the batched reader before baselines existed; TASK-2704 added baseline persistence but missed that reader. Preserve TASK-2732 baseline meaning and TASK-2734/TASK-2752's later review metadata.

Success criteria:

1. A stored review baseline survives both full Mission loading and the actual batched projection, including the subject used for current approval facts. Historical rounds without a baseline retain their established representation.
2. Share only the cohesive review-round column projection within the SQLite adapter and remove its duplicate definition. Reuse the existing hydration rules.
3. Preserve TASK-2401's performance contract: four review queries for a non-empty batch of up to 999 missions, safe chunking above that limit, and no MissionStore.load calls for board review/approval facts. Preserve intentional omission of unrelated aggregate relations.
4. Retain decision revisions, revocation/supersession and integration-repair metadata. Extend the existing review-read-projection contract with a focused baseline regression and keep its batching/no-aggregate-load assertions passing.
5. Follow existing verification. This repair changes projection fidelity without changing approval policy, stored baselines, schema or query count.
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
