---
id: TASK-2392
title: active tasks are shown in the backlog lane
status: review
assignee: [codex]
created_date: '2026-08-22 09:54'
labels: [ai_sdlc, bug]
dependencies: []
ordinal: 106917
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
> @magnusekdahl/parallix@1.5.5 dev
> tsx src/entry/px.ts

px board parallix wip 15 · attention 5 · 10/wk                                                                                                                                                                                                                                                                                                                         ⚠ unavailable  ▥ FLOW
● claude 0 running   ● codex 0 running   ● custom 0 running   ● qwen 3d · 0 running parsed: (?:\b429\b[^\n]*?\bAllocated quota exceeded\b|\bQuota exhausted:[\s\S]{0,500}\bcause:\s*insufficient_quota:\s*429\b)   ● vibe 0 running   1 running · family unknown

┌────────────────────────────────┐ ── BACKLOG 9 med 24.79005m (n=279)                       ── REFINED 2                                              ── ACTIVE 2 med 38.30715m (n=279)                        ── REVIEW 1 med 28.828433333333333m (n=279)              ── INTEGRATION 0 med 0.7406416666666666m (n=279)          ── DONE 1
│ ● WORKING 1                    │
│ task-2380 · review · operation │ ▶task-2268                                       active  ┃task-2235                             [ai_sdlc]start ▶   ┃task-2377.05                           [ai_sdlc]custom  ┃task-2332                          [architecture]codex  nothing in integration                                    ┃task-2337                                 [user_value]
│                                │ Centralize verification area resolution across lifecyc…  Human review submissions are not first-class in the pa…   Migrate CLI and handoff bounces to the rebound kernel    Post-2322 cleanup — Ports and adapters architecture                                                                custom model has been halucinated away
│ ▲ NEEDS YOU NEXT 5             │ active                                                   start ▶                                                   CP-5 gate · no-op                                        CP-6 gate · no-op
│                                │                                                                                                                    next: submit the mission for review with `px review ta…  next: All six checkpoints complete. Run final mission …
│   01 task-2377.05              │ ┃task-2283                                  [web]active  ┃task-2384                                 [bug]start ▶   PR #311 · review pending                                 PR #272 · review pending
│  [blocking]                    │ Implement local web operator board over shared contrac…  Self-review by the PR author dead-ends instead of esca…   ckpt handoff                                             review ▶
│ autonomous review stopped: implemactivereported PARKED                                    start ▶                                                   ▲ autonomous review stopped: implementer reported PARK…
│ $ px active task-2377.05       │
│  run ▶                         │ ┃task-2358                                  [bug]active                                                            ┃task-2380                                  [bug]custom
│                                │ Prevent PR history noise from blocking mission reviews                                                             Claude stale-session resume failure blocks agent inste…
│   02 task-2382                 │ active                                                                                                             CP-3 gate · no-op
│  [blocking]                    │                                                                                                                    next: Review the handed-off change.
│ legacy handoff failed          │ ┃task-2361                              [ai_sdlc]active                                                            PR #314 · review pending
│ $ px active task-2382          │ Measure the second post-boundary 20-completed-mission …                                                            ckpt handoff
│  run ▶                         │ active
│                                │
│   03 task-2386                 │ ┃task-2373.01                        [user_value]active
│  [blocking]                    │ Add macOS and Windows process-start identities
│ legacy handoff failed          │ active
│ $ px active task-2386          │
│  run ▶                         │ ┃task-2377                              [ai_sdlc]active
│                                │ unavailable
│   04 task-2388                 │ active
│  [blocking]                    │
│ autonomous review stopped: REVIEW┃task-2382T_INFRA_FAILURE               [ai_sdlc]active
│ $ px active task-2388          │ Split out-of-scope worktree and lock changes from task…
│  run ▶                         │ active
│                                │ ▲ legacy handoff failed
│   05 task-2332                 │
│  [review-l ⚠ task-markdown     │ ┃task-2386                                  [bug]active
│ ane]      unavailable          │ Make agent handoff prompts completion-safe
│ Awaiting review decision       │ active
│ $ px review task-2332          │ ▲ legacy handoff failed
│  unavailable                   │
│                                │ +1 more
│                                │
│ ranked: integrate>review>active│
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
