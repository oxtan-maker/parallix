---
id: TASK-2368
title: agent running review is not detected
status: refined
assignee: [codex]
created_date: '2026-08-12 09:24'
labels: [ai_sdlc, bug]
dependencies: []
ordinal: 91913
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
I got this view from px

magnus@debian:~/code/parallix$ npm run dev --

> @magnusekdahl/parallix@1.4.126 dev
> tsx src/entry/px.ts

px board parallix wip 12 · attention 1 · 0/wk                                                                                                                                                                                                                                                                                                                          ⚠ unavailable  ▥ FLOW
● claude 0 running   ● codex 1 running   ● custom 1 running   ● qwen 0 running   ● vibe 37m · 0 running exit 1: Error: API error from mistral (model: mistral-vibe-cli-latest): LLM backend error [mistral]   1 running · family unknown

┌────────────────────────────────┐ ── BACKLOG 7                                             ── REFINED 2                                              ── ACTIVE 1                                              ── REVIEW 1                                              ── INTEGRATION 0                                          ── DONE 1
│ ▲ NEEDS YOU NEXT 1             │
│                                │ ▶task-2268                                       active  ┃task-2235                             [ai_sdlc]start ▶   ┃task-2367                               [ai_sdlc]codex  ┃task-2274                              [ai_sdlc]custom  nothing in integration                                    ┃task-2337                                 [user_value]
│   01 task-2274                 │ Centralize verification area resolution across lifecyc…  Human review submissions are not first-class in the pa…   Fix integration completion, remove telemetry completio…  route role-owned review artifact failures to their pro…                                                            custom model has been halucinated away
│  [review-l ⚠ task-markdown     │ active                                                   start ▶                                                   unavailable gate · no-op                                 CP-3 gate · no-op
│ ane]      unavailable          │                                                                                                                    next: unavailable                                        next: Review the handed-off change.
│ Awaiting review decision       │ ┃task-2283                                  [web]active  ┃task-2332                        [architecture]start ▶   PR unavailable · review pending                          PR #271 · review pending
│ $ px review task-2274    run ▶ │ Implement local web operator board over shared contrac…  Post-2322 cleanup — Ports and adapters architecture       ckpt                                                     review ▶
│                                │ active                                                   start ▶
│                                │
│                                │ ┃task-2344                                  [bug]active
│                                │ Project full review round history into px status
│                                │ active

When actually claude was running review at the time on that mission and that mission needed no human attention. Check if this is a review detection/claude running detection error or what this is all about and fix it
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
