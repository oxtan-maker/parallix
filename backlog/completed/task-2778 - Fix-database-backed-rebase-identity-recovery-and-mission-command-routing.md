---
id: TASK-2778
title: 'Fix database-backed rebase identity, recovery and mission command routing'
status: done
assignee: [codex]
created_date: '2026-10-19 06:56'
labels:
  - bug
dependencies: []
priority: high
ordinal: 259008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Outcome
A database-backed mission can complete automatic pre-review rebase and successive conflict pauses without depending on legacy task or mission files. Recovery preserves the actual failure, identity, worktree, and attempt counts.

Observed incident: px-0014, 2026-10-18
The execute agent delivered handoff fixes. A fresh repair agent fixed the retired backlog/archive assertion in a9ab1da09; the harness reran verification successfully. Rebase onto local main then paused on package.json. The harness reported: No recorded implementer for px-0014; cannot launch conflict resolution. It never launched a conflict resolver and left Git paused. Recovery reclassified the new failure as InfraBlocker. Its final message claimed failure after two relaunch attempts, while persisted rebound telemetry records one repair attempt followed by escalation.
The mission database records assignee codex and has no review rounds; this ad hoc mission has no backlog task file. resolveRecordedImplementer in src/application/rebase-workflow.ts reads review state, then falls back to a task file, missing the Mission assignee. Review state does not exist before the first review. Do not repair this by recreating legacy metadata or manually assigning a task file.
The conflict detector also attempted dry merges against an already unmerged index, emitted scary non-conflict errors, then correctly fell back to index/rebase conflict discovery. This was diagnostic noise, not the terminal cause.
Later execute and review commands in the mission tmux console ran from /mnt/data/code/parallix on main and failed the expected mission-worktree/branch checks. Trace the console launcher, generated px wrapper, and backend command context to establish which invocation lost the mission context; do not assume those safety checks should be relaxed.

Evidence
Tmux socket: /run/user/1000/parallix-terminal/233bbddb32ac/px-0014.sock
Retained log: /run/user/1000/parallix-terminal/233bbddb32ac/px-0014.sock.log (search for No recorded implementer, Recovery incident changed, and Not on mission branch).
Execute session: 01a15082-3dd9-75a3-a14a-40b0f084cab1. Fresh repair session: 01a1508e-4fa9-7dc0-b7a8-b5eb6e5788a5.
Operational history: rebound.repair at 2026-10-18T19:49:11.021Z (attempt 1, maxAttempts 2, outcome escalate), followed by rebound.outcome at 19:49:11.087Z (attempts 1).
Manual recovery on 2026-10-19 completed the rebase. The branch included commits already squashed into main, including TASK-2750 and task creation; preserving newer main behavior and omitting duplicated task creation avoided resurrecting completed tasks. The archive relocation was already satisfied by main using its cancelled-task reference location. Include equivalent histories in the conflict-recovery investigation.

Scope
Trace rebase entry points, identity composition, conflict discovery, handoff/rebound reason propagation, retry reporting, and mission tmux command routing. Use the authoritative database through typed application ports and existing composition authority; preserve ports-and-adapters boundaries. Review nearby rebase paths for the same legacy file assumptions. Preserve explicit missing-identity and database-unavailable diagnostics rather than guessing an agent or silently masking persistence failures.
Do not change verification gates, CPU budgets, architectural principles, or real mission state to make the reproduction pass. No blanket ours/theirs resolution of shared files. Distinguish expected conflicts and empty/already-incorporated picks from genuine Git, hook, verification, or infrastructure failures. Do not promise arbitrary semantic conflict resolution without the existing authorization policy.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Add a focused reproduction in the existing owning suites: a Mission with database assignee codex, no review round, and no legacy task/mission files reaches a shared-file rebase conflict, launches the authorized implementer, and completes recovery. Demonstrate red on parent behavior and green with the fix.
- [ ] #2 Rebase identity comes from the authoritative Mission database through typed ports before review exists; cover precedence over stale file metadata, supported configured agents, missing identity, and persistence read failure without introducing a second authority.
- [ ] #3 Paused rebases discover current conflicts from Git state without attempting a dry merge into an unmerged index. Resolve and stage within existing policy, continue through successive pauses, and require no remaining rebase or unmerged files before reporting success.
- [ ] #4 Gate repair followed by a rebase conflict retains the actual structured cause and routes an eligible conflict to the resolver. Genuine human-only, hook, verification, command, and infrastructure failures remain bounded stops with actionable evidence; do not label an ordinary conflict as infrastructure by generic fallback.
- [ ] #5 Failure summaries, recovery dossiers, and persisted telemetry agree on actual attempts and stop reason. Early escalation after one launch does not claim two launches or repeat the original gate failure after that gate passed.
- [ ] #6 Mission-bound execute, handoff/review, retry, and suggested recovery commands use the resolved mission worktree and branch even when the tmux console started in the base checkout. Cover the actual losing path found during tracing; retain preflight checks and leave the base worktree untouched.
- [ ] #7 Cover already-squashed branch commits, duplicate/completed task creation, and main-side file relocation during recovery so replay preserves newer main behavior and does not resurrect retired metadata or completed work. Preserve unique mission changes and require semantic review of shared conflicts.
- [ ] #8 Manually exercise the public CLI and mission tmux command path with disposable repositories and isolated database state: database-only identity, repaired gate, successive conflicts, correct routing, accurate diagnostics, clean completion, and unchanged base checkout. Use existing owning suites at the narrowest ADR 0057 tier; each modified integration test stays within 3.5 seconds. Update affected live guidance without adding verification gates.
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
