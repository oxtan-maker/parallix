---
id: TASK-2232
title: stabilize and speed up the real custom-agent E2E smoke
status: backlog
assignee: []
created_date: '2026-07-12 06:07'
labels:
  - ai_sdlc
dependencies: []
references:
  - test/e2e-real-agent-smoke.test.js
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The integration-only real custom-agent smoke has reliability and runtime variability. One opencode draft run exited successfully after about 49 seconds while leaving the generated MISSION.md scaffold placeholders intact and making no usable draft; a retry produced a valid draft with 12 tool calls but the draft phase alone took 252232 ms. During that retry, the execute agent produced a checkpoint whose raw `bash hello.sh` output evidence correctly triggered an IncompleteEvidence repair relaunch. The repair prompt then instructed the agent to run `node parallix review task-9001 --submit`, which cannot work in the throwaway mission repo because there is no `parallix` module there; the lifecycle wrapper must remain responsible for resubmission or provide a valid CLI command. Investigate why the real launcher can report success without completing the requested edit, preserve the existing phantom-draft and checkpoint-evidence rejection, support both first-try-valid and repaired checkpoint paths without manufacturing an empty commit, improve diagnostics and repair instructions, and reduce gate wall time without replacing the real launcher boundary with a stub.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A successful px draft that leaves scaffold placeholders or otherwise makes no meaningful mission edit is either prevented by the product contract or reported with enough launcher evidence to identify the cause.
- [ ] #2 The E2E continues to fail on phantom drafts instead of retrying away or accepting them.
- [ ] #3 The real custom-agent launcher boundary remains covered.
- [ ] #4 Measured draft and full-lifecycle durations are documented before and after any speed optimization.
- [ ] #5 Both a checkpoint accepted on the first handoff attempt and a checkpoint corrected through the IncompleteEvidence repair relaunch can complete the lifecycle without an artificial operator edit or empty commit.
- [ ] #6 Repair instructions do not tell the agent to run a nonexistent `node parallix` entry point from the mission worktree.
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
