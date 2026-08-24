---
id: TASK-2408
title: Remove halucinated content
status: backlog
assignee: [codex]
created_date: '2026-08-24 03:37'
labels: [user_value, bug]
dependencies: []
ordinal: 116917
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
px board parallix wip 16 · attention 1 · 2/wk                                                                                                                                                                                                                                                                                                                          ⚠ unavailable  ▥ FLOW
work: 2 live · 14 idle   ● claude 0 px cmd live   ● codex 1 px cmd live   ● custom 1 px cmd live   ● qwen 1d · 0 px cmd live parsed: (?:\b429\b[^\n]*?\bAllocated quota exceeded\b|\bQuota exhausted:[\s\S]{0,500}\bcause:\s*insufficient_quota:\s*429\b)   ● vibe 0 px cmd live

┌────────────────────────────────┐ ── BACKLOG 10 med 10.183791666666668m (n=294)            ── REFINED 1                                              ── ACTIVE 1 med 13.313266666666667m (n=294)              ── REVIEW 2 med 9.725508333333334m (n=294)               ── INTEGRATION 0 med 0.3872083333333333m (n=294)          ── DONE 2
│ 2                              │
│ task-2406 · execute · codex    │ ▶task-2268                                       active  ┃task-2235                             [ai_sdlc]start ▶   ┃task-2406                            [user_value]codex  ┃task-2377.05                            [ai_sdlc]codex  nothing in integration                                    ┃task-2337                                 [user_value]
│ task-2377.05 · review · custom │ Centralize verification area resolution across lifecyc…  Human review submissions are not first-class in the pa…   px draft is not detected in ui                           Migrate CLI and handoff bounces to the rebound kernel                                                              custom model has been halucinated away
│                                │ active                                                   start ▶                                                   unavailable gate · no-op                                 CP-5 gate · no-op
│ ▲ NEEDS YOU NEXT 1             │                                                                                                                    next: unavailable                                        next: submit the mission for review with `px review ta…                                                            ┃task-2389                                 [user_value]
│                                │ ┃task-2283                                  [web]active                                                            PR unavailable · review pending                          PR #311 · review pending                                                                                           Align operator UIs on truthful agent activity semantics
│   01 task-2403                 │ Implement local web operator board over shared contrac…                                                            ckpt                                                     review ▶
│  [review-l ⚠ task-markdown     │ active
│ ane]      unavailable          │                                                                                                                                                                             ┃task-2403                            [user_value]codex
│ Awaiting review decision       │ ┃task-2358                                  [bug]active                                                                                                                     Make unit tests fast and enforce a one-second per-test…
│ $ px review task-2403          │ Prevent PR history noise from blocking mission reviews                                                                                                                      CP-3 gate · no-op
│  unavailable                   │ active                                                                                                                                                                      next: rerun `./scripts/verify-local.sh all` against th…
│                                │                                                                                                                                                                             PR #328 · review pending
│                                │ ┃task-2361                              [ai_sdlc]active                                                                                                                     review ▶
│                                │ Measure the second post-boundary 20-completed-mission …
│                                │ active
│                                │
│                                │ ┃task-2373.01                        [user_value]active
│                                │ Add macOS and Windows process-start identities
│                                │ active
│                                │
│                                │ ┃task-2377                              [ai_sdlc]active
│                                │ unavailable
│                                │ active
│                                │
│                                │ ┃task-2390                                       active
│                                │ investigate agents.config
│                                │ active
│                                │
│                                │ ┃task-2396                                  [bug]active
│                                │ Reset mission base branch when px draft starts
│                                │ active
│ ranked: integrate>review>active│
└────────────────────────────────┘ +2 more

Remove the content inside the box that has ▲ NEEDS YOU NEXT 1, ▲ NEEDS YOU NEXT 1 should be the first thing in that box, everything above ▲ NEEDS YOU NEXT 1 (IN THE BOX ONLY) is halucinated content. I.e. example 

2
task-2406 · execute · codex
[user_value]
task-2377.05 · review · custom

--
Also ensure that raw db content does not leak into the work row, example:

parsed: (?:\b429\b[^\n]*?\bAllocated quota exceeded\b|\bQuota exhausted:[\s\S]{0,500}\bcause:\s*insufficient_quota:\s*429\b)
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
