---
id: TASK-2482
title: Remove the unused px checkpoint command and its verification footgun
status: done
assignee: [codex]
created_date: '2026-09-10 18:38'
labels:
  - ai_sdlc
dependencies: []
references:
  - src/composition/create-cli.ts
  - src/application/checkpoint-command-use-case.ts
  - src/adapters/cli/commands/checkpoint.ts
  - src/application/handoff-command-use-case.ts
  - prompts/execute-core.md
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The px checkpoint CLI command is still exposed and runs repository verification before staging and committing. Investigation on mission/task-2470 found no internal workflow caller and no execution prompt instructing agents to use it. Its presence invites agents to choose an unnecessary and potentially expensive verification path, and has already led to incorrect README claims that every execution checkpoint runs verification.

Remove this command and command-only implementation, wiring, help, suggestions, tests, and live guidance. Trace references before deletion: checkpoint evidence documents, local progress commits, resume context, and the separate checkpoint-recording service used before review remain required. Preserve those capabilities and verification at the intended lifecycle transitions. This task does not remove checkpointing as a workflow concept.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 px checkpoint is no longer registered, advertised, suggested, or executable; invoking it cannot run verification, stage files, or create a commit.
- [ ] #2 Command-only implementations and tests are removed, including obsolete legacy copies; shared checkpoint evidence and recovery functionality remains intact.
- [ ] #3 Execution still records and commits checkpoint evidence and can resume from it; the transition to review still records and validates required checkpoint evidence.
- [ ] #4 Live documentation and agent guidance contain no instructions to invoke px checkpoint or claims that every execution checkpoint automatically runs verification; historical mission records remain unchanged.
- [ ] #5 Focused regression checks and required repository verification, including static-analysis for code changes, pass.
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
