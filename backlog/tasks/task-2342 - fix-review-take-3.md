---
id: TASK-2342
title: fix review take 3
status: active
assignee: [custom]
created_date: '2026-08-04 17:21'
labels: [ai_sdlc, bug]
dependencies: []
ordinal: 81900
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Codex bug: persistReviewStateOrThrow drops missionStore                                                                                                                                                                                                                                                
                                                                                                                                                                                                                                                                                                        
 writeReviewState(slug, state, worktree, missionStore) needs 4th param for SQLite. persistReviewStateOrThrow(writeFn, slug, state, worktree) calls writeFn(slug, state, worktree) — omits missionStore. Every review-loop call site (review-loop.ts lines 94, 202, 221, 465, 813, 1042, 1062, 1163,     
 1290, 1372, 1468, 1532, 1579, 1610, 1623, 1630, 1686, 1696) inherits this. Result: resolveMissionStore(worktree, undefined) → null → "Operator database unavailable for task-2328" → loop crashes after reviewer completes.                                                                            
                                                                                                                                                                                                                                                                                                        
 Events persist to SQLite because createEvent receives missionStore through CreateEventOptions (injected by caller). State persistence has no such path.                                                                                                                                                
                                                                                                                                                                                                                                                                                                        
 Secondary: consumeHumanNotes no dedup. Fetches ALL PR comments every call. No dedup key → same comments re-processed each round. 19 events = 19 PR comments lacking workflow footer.
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
