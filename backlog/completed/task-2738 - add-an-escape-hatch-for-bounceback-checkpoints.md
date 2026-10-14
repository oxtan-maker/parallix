---
id: TASK-2738
title: add an escape hatch for bounceback checkpoints
status: done
assignee: [codex]
created_date: '2026-10-13 14:42'
labels: []
dependencies: []
ordinal: 235008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
npm run dev -- review --continue

> @magnusekdahl/parallix@1.5.352 dev
> tsx src/entry/px.ts review --continue

[INFO] Resuming persisted implementer: claude
[INFO] Checking review-provider availability at http://localhost:3300...
[INFO] Review provider is running and reachable at http://localhost:3300.
[INFO] Review PR #683 confirmed open for mission/task-2735.
[INFO] No completed handoff for mission/task-2735 (task in active) — performing handoff (attempting automatic handoff) via px review task-2735 --start...
[INFO] Repository gates (handoff): none configured — skipping.
[FAIL] Planned checkpoint evidence is missing before handoff: CP-6. Record fresh evidence with px checkpoint record before handoff.
[FAIL] Handoff failed for mission/task-2735: Planned checkpoint evidence is missing before handoff: CP-6. Record fresh evidence with px checkpoint record before handoff..
       Run: px review task-2735 --start after resolving the error.

Here the bounceback tried autorepair and when it got to human I just restart the agent, but I cannot since I cannot use the agent to fix it since there is a new checkpoint (and that is fine, when the review starts in act-on-review/bounceback mode)
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
