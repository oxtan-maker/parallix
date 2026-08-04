---
id: TASK-2341
title: Review code bug
status: backlog
assignee: []
created_date: '2026-08-04 12:27'
labels: []
dependencies: []
ordinal: 75900
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
px status task-2337 shows "Review: not started" despite DB having approved review. Root cause:                                                                                                                                                                                                           
                                                                                                                                                                                                                                                                                                          
 1. src/adapters/review/review-state.ts:112 — resolveMissionStore() returns store ?? null. When no store passed (default path), returns null.                                                                                                                                                             
 2. ConcreteReviewReadAdapter.loadReview() calls readReviewState(slug, rootDir) without missionStore arg.                                                                                                                                                                                                 
 3. readReviewState() gets null store, returns null immediately — DB never queried.                                                                                                                                                                                                                       
 4. BoardProjectionBuilder.build() reads missions from ConcreteMissionReadAdapter (sets review: null), calls only loadReviewApproval() (not loadReview()). Full review never merged into mission.                                                                                                         
 5. projectMissionCard() checks mission.review — always null — so reviewPhase always null.                                                                                                                                                                                                                
                                                                                                                                                                                                                                                                                                          
 Affects ALL missions, not just task-2337. Fix: either wire missionStore through to ConcreteReviewReadAdapter, or have BoardProjectionBuilder load full review and merge into mission before projection.
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
