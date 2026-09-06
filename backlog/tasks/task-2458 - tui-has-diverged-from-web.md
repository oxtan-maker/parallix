---
id: TASK-2458
title: tui has diverged from web
status: backlog
assignee: []
created_date: '2026-09-06 08:02'
labels: []
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
tui shows a lot of mission it should not, find the duplicated code between web and tui and fix it so we don't have two codebases that diverge massivly (most likely backend movement but check the ADR:s)

Example of current state shown magnus@debian:~/code/parallix$ npm run dev --

> @magnusekdahl/parallix@1.5.77 dev
> tsx src/entry/px.ts

px board parallix wip 23 · attention 16 · 15/wk                                                                                                                                                                                                                                                                                                                        ⚠ unavailable  ▥ FLOW
work: 1 blocked · 34 idle   ● claude 0 px cmd live   ● codex 0 px cmd live   ● custom 0 px cmd live   ● qwen 2d · 0 px cmd live usage limit reached   ● vibe 0 px cmd live

┌────────────────────────────────┐ ── BACKLOG 11 med 7.024366666666666m (n=349)             ── REFINED 0 med 19.995316666666668m (n=349)              ── ACTIVE 7 med 8.564016666666667m (n=349)               ── REVIEW 13 med 63.858333333333334m (n=349)             ── INTEGRATION 3 med 16.9762m (n=349)                     ── DONE 1
│                                │
│ ▲ NEEDS YOU NEXT 16            │ ▶task-2235                               [ai_sdlc]draft  nothing in refined                                        ┃task-1270                            [[ai_sdlc]]custom  ┃task-2455.03                               [bug]custom  ┃task-2457                                  [bug]custom   ┃task-2446                                    [ai_sdlc]
│                                │ Human review submissions are not first-class in the pa…                                                            task-1270                                                enforce workflow config schema validation                make lifecycle gates repository-configured and self-ho…   Scope FLOW cumulative state to the current reporting w…
│   01 task-2200                 │ draft                                                                                                              CP-4 gate · no-op                                        CP-3 gate · no-op                                        CP-4 gate · no-op
│  [review-l ⚠ task-markdown     │                                                                                                                    next: Review the handed-off change.                      next: escalate the three pre-existing `main` test fail…  next: Review the handed-off change.
│ ane]      unavailable          │ ┃adhoc-2377                              [unknown]draft                                                            PR #259 · review pending                                 PR #387 · review pending                                 PR #386 · review approved
│ Awaiting review decision       │ adhoc-2377                                                                                                         handoff                                                  review ▶                                                 integrate ▶
│ $ px review task-2200          │ draft
│  unavailable                   │                                                                                                                    ┃task-2230                               [ai_sdlc]codex  ┃task-2200                        [[ai_sdlc, bug]]codex  ┃task-2324                             [[ai_sdlc]]codex
│                                │ ┃adhoc-taks-2371                         [unknown]draft                                                            task-2230                                                task-2200                                                task-2324
│   02 task-2265                 │ adhoc-taks-2371                                                                                                    CP-3 gate · no-op                                        CP-4 gate · no-op                                        unavailable gate · no-op
│  [review-l ⚠ task-markdown     │ draft                                                                                                              next: unavailable                                        next: unavailable                                        next: unavailable
│ ane]      unavailable          │                                                                                                                    PR unavailable · review approved                         PR unavailable · review approved                         PR unavailable · review pending
│ Awaiting review decision       │ ┃task-1373                                    [[]]draft                                                            handoff handoff                                          review ▶ handoff                                         integrate ▶
│ $ px review task-2265          │ task-1373
│  unavailable                   │ draft                                                                                                              ┃task-2237                          [[user_value]]codex  ┃task-2265                                    [[]]codex  ┃task-2389                           [user_value]claude
│                                │                                                                                                                    task-2237                                                task-2265                                                task-2389
│   03 task-2327                 │ ┃task-2221                                   [adr]draft                                                            CP-3 gate · no-op                                        CP-3 gate · no-op                                        CP-3 gate · no-op
│  [review-l ⚠ task-markdown     │ task-2221                                                                                                          next: unavailable                                        next: hand the clean, committed mission branch to Para…  next: hand off for review; no further projection, cons…
│ ane]      unavailable          │ draft                                                                                                              PR unavailable · review approved                         PR unavailable · review approved                         PR #315 · review approved
│ Awaiting review decision       │                                                                                                                    handoff handoff                                          review ▶ handoff                                         integrate ▶
│ $ px review task-2327          │ ┃task-2267                                   [bug]draft
│  unavailable                   │ task-2267                                                                                                          ┃task-2322.12                           [ai_sdlc]custom  ┃task-2327                       [resource_usage]custom
│                                │ draft                                                                                                              task-2322.12                                             task-2327
│   04 task-2332.01              │                                                                                                                    unavailable gate · no-op                                 CP-3 gate · no-op
│  [review-l ⚠ task-markdown     │ ┃task-2268                                    [[]]draft                                                            next: unavailable                                        next: Review the handed-off change.
│ ane]      unavailable          │ task-2268                                                                                                          PR unavailable · review approved                         PR unavailable · review approved
│ Awaiting review decision       │ draft                                                                                                              handoff                                                  review ▶ handoff
│ $ px review task-2332.01       │
│  unavailable                   │ ┃task-2272                                   [bug]draft                                                            ┃task-2332.06                      [architecture]custom  ┃task-2332.01                       [architecture]codex
│                                │ task-2272                                                                                                          task-2332.06                                             task-2332.01
│   05 task-2332.02              │ draft                                                                                                              CP-6 gate · no-op                                        CP-4 gate · no-op
│  [review-l ⚠ task-markdown     │                                                                                                                    next: submit the platform-free diff for review; any fo…  next: TASK-2332.02 must remove the composition-owned e…
│ ane]      unavailable          │ +3 more                                                                                                            PR #250 · review approved                                PR unavailable · review approved
│ Awaiting review decision       │                                                                                                                    handoff handoff                                          review ▶ handoff
│ $ px review task-2332.02       │
│  unavailable                   │                                                                                                                    ┃task-2369.08                           [ai_sdlc]custom  ┃task-2332.02                       [architecture]codex
│                                │                                                                                                                    task-2369.08                                             task-2332.02
│ +11 more                       │                                                                                                                    CP-3 gate · no-op                                        CP-4 gate · no-op
│                                │                                                                                                                    next: Review the handed-off change.                      next: Parallix can inspect the committed checkpoint an…
│                                │                                                                                                                    PR #287 · review pending                                 PR unavailable · review approved
│                                │                                                                                                                    handoff                                                  review ▶ handoff
│                                │
│                                │                                                                                                                    ┃task-2382                               [ai_sdlc]codex  ┃task-2332.03                       [architecture]codex
│                                │                                                                                                                    task-2382                                                task-2332.03
│                                │                                                                                                                    unavailable gate · no-op                                 CP-4 gate · no-op
│                                │                                                                                                                    next: unavailable                                        next: hand off the committed mission for review; no li…
│                                │                                                                                                                    PR unavailable · review pending                          PR unavailable · review approved
│                                │                                                                                                                    ▲ legacy handoff failed                                  review ▶ handoff
│                                │
│                                │                                                                                                                                                                             ┃task-2332.04                      [architecture]claude
│                                │                                                                                                                                                                             task-2332.04
│                                │                                                                                                                                                                             CP-5 gate · no-op
│                                │                                                                                                                                                                             next: hand off for review; if a reviewer asks for a de…
│                                │                                                                                                                                                                             PR unavailable · review approved
│                                │                                                                                                                                                                             review ▶ handoff
│ ranked: integrate>review>active│
└────────────────────────────────┘                                                                                                                                                                             +5 more
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
