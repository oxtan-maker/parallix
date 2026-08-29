---
id: TASK-2441
title: ink ui cannot see title of missions anymore
status: done
assignee: [claude]
created_date: '2026-08-29 15:19'
labels:
  - user_value
  - bug
dependencies: []
ordinal: 123917
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
── ACTIVE 2 med 8.6996m (n=320)                          ── REVIEW 1 med 5.55525m (n=320)                         ── INTEGRATION 0 med 0.36978333333333335m (n=320)         ── DONE 2
│                                │
│ ▲ NEEDS YOU NEXT 0             │ ▶task-2235                              [ai_sdlc]active  nothing in refined                                        ┃task-2373.01                        [user_value]custom  ┃task-2427                               [ai_sdlc]codex  nothing in integration                                    ┃task-2337
│                                │ Human review submissions are not first-class in the pa…                                                            <Title> (task-2373.01)                                   <Title> (task-2427)                                                                                                <Title> (task-2337)
│ nothing needs attention        │ active                                                                                                             CP-2 gate · no-op                                        CP-3 gate · no-op
│                                │                                                                                                                    next: Review the handed-off change.                      next: hand off — every declared checkpoint (CP-1, CP-2…                                                            ┃task-2377
│                                │ ┃task-2268                                   [[]]active                                                            PR #337 · review pending                                 PR #357 · review pending                                                                                           <Title> (task-2377)
│                                │ Centralize verification area resolution across lifecyc…                                                            ckpt handoff                                             review ▶
│                                │ active
│                                │                                                                                                                    ┃task-2439                               [ai_sdlc]codex
│                                │ ┃task-2418                                  [bug]active                                                            <Title> (task-2439)
│                                │ Read mission lifecycle from the integration base, not …                                                            CP-4 gate · no-op
│                                │ active                                                                                                             next: hand off the committed mission for review.
│                                │                                                                                                                    PR #358 · review pending
│                                │ ┃task-2428                              [ai_sdlc]active                                                            ckpt handoff
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
