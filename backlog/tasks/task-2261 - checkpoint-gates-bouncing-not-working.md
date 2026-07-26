---
id: TASK-2261
title: checkpoint gates bouncing not working
status: ready-for-integration
assignee: [custom]
created_date: '2026-07-14 03:33'
labels: [ai_sdlc]
dependencies: []
ordinal: 47000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
[PASS] Execute safety harness: no uncommitted mission changes left behind.
[INFO] 
[INFO] Execute agent (custom) completed successfully. Recording execute-phase stats...
[INFO] 
[INFO] Execute agent (custom) completed successfully. Starting automated handoff...
No checkpoint documents found in /home/magnus/code/parallix-task-2225/missions/task-2225. The execute agent must create checkpoint documents (CP-N.md) with a Goal Check table before handoff. Create at least CP-1 documenting your implementation, including a Goal Check table with real evidence (file:line, test names).
       Create a checkpoint document (CP-N.md) in /home/magnus/code/parallix-task-2225/missions/task-2225 with a Goal Check table.
       Then re-run: px review task-2225 --submit
<!-- SECTION:DESCRIPTION:END -->

## Codex Pre-Draft

**Goal:** turn a missing required checkpoint after a successful execute phase into a correctly classified, actionable repair bounce rather than a stranded handoff failure.

**Scope and proof:** reproduce the TASK-2225 failure with a deterministic implementer fixture; trace checkpoint discovery, error classification, relaunch prompting, and retry state; ensure the repair prompt names the missing `CP-N.md`, required Goal Check table, and exact retry command; cover successful repair and repeated failure/exhaustion.

**Checkpoints:** (1) red handoff fixture; (2) missing-artifact classification and targeted relaunch; (3) lifecycle regression coverage and evidence that a valid CP unblocks handoff.

**Stop rule:** do not synthesize checkpoint evidence on behalf of the implementer or allow handoff/review to continue without a real checkpoint document and Goal Check table.

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
