---
id: TASK-2313
title: ui becomes corrupted
status: backlog
assignee: []
created_date: '2026-07-26 05:53'
labels: []
dependencies: []
ordinal: 66000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
after a while the ui becomes corrupted in the terminal > tsx --import ./src/entry/esm-globals.ts src/entry/px.ts ui

px board parallix wip 35 · attention 1                                                                                                                                                                                                                                                                                                                                         ⚠ unavailable
┌────────────────────────────────┐ ── BACKLOG 32                                            ── REFINED 1                                              ── ACTIVE 1                                              ── REVIEW 1                                              ── INTEGRATION 0                                          ── DONE 0
│ ▲ NEEDS YOU NEXT               │
│                                │ ▍task-1270 · unavailable                                 ▍task-2297 · codex                                        ▍task-2305 · codex                                       ▍task-2312 · custom                                      nothing in integration                                    nothing in done
px board parallix wip 35 · attention 1                                                                                                                                                                      ⚠ unavailable
┌────────────────────────────────┐ ── BACKLOG 32                 ── REFINED 1                  ── ACTIVE 1                    ── REVIEW 1                   ── INTEGRATION 0              ── DONE 0
│ ▲ NEEDS YOU NEXT               │
│                                │ ▍task-1270 · unavailable      ▍task-2297 · codex            ▍task-2305 · codex             ▍task-2312 · custom           nothing in integration        nothing in done
│ 01 task-2312                   │ Reviewer specialization       graphify does not work for …  unavailable                    labelling has broken
│  [review-lane]                 │ cp unavailable · gate unkno…  cp unavailable · gate unkno…  cp unavailable · gate unkno…   cp unavailable · gate unkno…
│ Awaiting review decision       │ next: unavailable             next: unavailable             next: unavailable              next: unavailable
│ $ px review task-2312          │ PR unavailable · review pen…  PR unavailable · review pen…  PR unavailable · review pen…   PR unavailable · review pen…
│                                │
│                                │ ▍task-1294 · unavailable
│                                │ documentation update hook
│                                │ cp unavailable · gate unkno…
│                                │ next: unavailable
│                                │ PR unavailable · review pen…
│                                │
│                                │ ▍task-2217 · unavailable
│                                │ Extract stats report render…
│                                │ cp unavailable · gate unkno…
│                                │ next: unavailable
│                                │ PR unavailable · review pen…
│                                │
│                                │ ▍task-2219 · unavailable
│                                │ Extract Forgejo API transpo…
│                                │ cp unavailable · gate unkno…
│                                │ next: unavailable
│                                │ PR unavailable · review pen…
│                                │
│                                │ ▍task-2221 · unavailable
│                                │ Decide the trust boundary f…
│                                │ cp unavailable · gate unkno…
│                                │ next: unavailable
│                                │ PR unavailable · review pen…
│                                │
│                                │ ▍task-2235 · unavailable
│                                │ Human review submissions ar…
│                                │ cp unavailable · gate unkno…
│                                │ next: unavailable
│                                │ PR unavailable · review pen…
│                                │
│                                │ ▍task-2259 · unavailable
│                                │ Make px integrate retryable…
│                                │ cp unavailable · gate unkno…
│                                │ next: unavailable
│                                │ PR unavailable · review pen…
│                                │
│                                │ ▍task-2260 · unavailable
│                                │ unavailable
│                                │ cp unavailable · gate unkno…
│                                │ next: unavailable
│                                │ PR unavailable · review pen…
│ ranked: integrate>review>active│
└────────────────────────────────┘ +24 more
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
