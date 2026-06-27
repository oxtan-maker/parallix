---
id: TASK-1379
title: >-
  Replace agent-usage % size signal with Net Engineering Lines (NEL) bucket +
  capture actual at handoff
status: backlog
assignee: []
created_date: '2026-06-27 13:44'
labels:
  - ai_sdlc
dependencies:
  - TASK-1355
references:
  - docs/adr/0047-per-mission-change-size-budget.md
  - missions/task-1355/findings.md
  - missions/task-1355/data/dataset.md
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implements ADR 0047. Change the mission size-estimation basis from "Estimated agent % usage limit" to a predicted **Net Engineering Lines (NEL)** bucket, and start recording the actual NEL at handoff so the draft estimate can be checked for reliability (calibration-first; no gate yet).

NEL = insertions+deletions in code and test files, computed `-w`, EXCLUDING:
- workflow/process bookkeeping: `missions/**`, `backlog/**`, `review-*`, `CP-*`
- documentation: `**/*.md`, `docs/**`
- generated/vendored: `package-lock.json`, `coverage/**`, lockfiles/build output

Buckets (empirical risk terciles from task-1355 data, n=29):
- Small: 0–80 NEL (11% rework rate)
- Medium: 81–235 NEL (22%)
- Large: 235+ NEL (73%)

Scope:
- Update `MISSION.md` template / draft refinement signals to ask for a predicted NEL bucket instead of "Estimated agent % usage limit".
- Add a small, reusable NEL computation (from `git diff --numstat`) honoring the exclusion globs above.
- At handoff/integration, compute actual NEL from the merge diff and record `(predicted bucket, actual NEL, actual bucket, review rounds)` per mission so the prediction-vs-actual series accumulates.
- Update ADR 0032 / 0036 references where the "% usage" signal is described, to point at NEL.

Out of scope (deferred to a later ADR once calibration data exists):
- Any threshold gate, hard block, review-depth escalation, or forced decomposition on breach. This task only changes the unit and records data.

See `docs/adr/0047-per-mission-change-size-budget.md` and `missions/task-1355/findings.md`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The MISSION.md draft signal asks for a predicted NEL bucket (Small 0-80 / Medium 81-235 / Large 235+) instead of 'Estimated agent % usage limit'
- [ ] #2 A reusable function computes NEL from a git diff, excluding missions/**, backlog/**, review-*, CP-*, **/*.md, docs/**, package-lock.json, coverage/**, and lockfiles, computed whitespace-insensitively
- [ ] #3 At handoff/integration the actual NEL is computed and a per-mission record of (predicted bucket, actual NEL, actual bucket, review rounds) is persisted
- [ ] #4 No enforcement, gate, block, or review escalation is added — the task only changes the estimation unit and records prediction-vs-actual data
- [ ] #5 ADR 0032 and 0036 references to the agent-usage % size signal are updated to reference NEL
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
