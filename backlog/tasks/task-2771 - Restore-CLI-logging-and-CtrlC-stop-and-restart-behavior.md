---
id: TASK-2771
title: Restore CLI logging and Ctrl+C stop-and-restart behavior
status: backlog
assignee: []
created_date: '2026-10-16 12:09'
labels:
  - bug
dependencies: []
priority: high
ordinal: 258008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Restore the user-visible CLI behavior from before TASK-2750 (aa1bd73db547afd62a19b82619ca71e96b93a87a): readable live logging and Ctrl+C that stops the command and its work cleanly. Users must not need to understand workflow owners, supervisors, tmux, servers or history replay to interrupt and restart a command.

Reproduction reported on debian: run px review --start from mission/task-2770 while repository verification is running. Spinner frames concatenate into one long line. Press Ctrl+C: the shell returns, but immediately repeating px review --start fails with "Another workflow owns this mission; stop it before restarting".

Investigation: TASK-2750 routes CLI commands through detached --workflow-worker/--workflow-execute processes and replays coordinator history. workflowCliObserver consumes terminal.page(), whose stripTerminalControl removes bare carriage returns used by the progress spinner. Detached execution survives termination of the foreground observer. This is local execution, separate from the review provider at localhost:3300. The October 15 commit 8ddb1303d ("improved logging for mission gates") only adds an informational message and is not the cause.

Restore the previous terminal experience across affected long-running CLI commands, including review/handoff, draft and integration: preserve readable ordered live output and normal in-place progress; Ctrl+C means stop the invoked work, settle its children and ownership, preserve valid mission state/evidence, then return control. px stop remains an optional equivalent stop mechanism and must also leave consistent restartable state. Do not silently detach on Ctrl+C or make users issue a second cleanup command. Keep independent web-started workflows and unrelated missions isolated from a CLI interruption. Preserve architectural boundaries and operator-owned gates; this request concerns user behavior, not a blanket revert of TASK-2750.

Retain focused red-on-parent regressions in the owning suites. Manually exercise the real CLI with an isolated fixture and a lightweight held verification child, both Ctrl+C and px stop, then immediately retry. Include logging under a real PTY and redirected output. Do not run destructive experiments against operator state or real integrations.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Interactive logging matches the pre-TASK-2750 experience: progress updates replace the current line, messages remain readable and ordered, and no concatenated spinner stream or internal operation chatter replaces normal command output.
- [ ] #2 Ctrl+C during preparation, verification or agent execution stops the invoked CLI workflow and owned child work, settles ownership, and returns promptly with an interrupted outcome; repeated Ctrl+C is handled safely.
- [ ] #3 After either Ctrl+C or px stop has completed, immediately repeating the appropriate command works without stale-owner refusal, manual process cleanup, overlapping writers or an incorrectly completed mission.
- [ ] #4 Stopping one workflow preserves the mission and retained evidence, affects no unrelated mission or independently web-started workflow, and cannot allow stale callbacks to change a replacement run.
- [ ] #5 Focused regressions demonstrate the reported failures on parent behavior and pass with the fix; manual isolated CLI checks cover readable live output, Ctrl+C, px stop and immediate retry without changing verification gates.
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
