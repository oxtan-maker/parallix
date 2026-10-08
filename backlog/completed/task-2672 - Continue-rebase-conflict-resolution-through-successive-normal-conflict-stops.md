---
id: TASK-2672
title: Continue rebase conflict resolution through successive normal conflict stops
status: done
assignee: [codex]
created_date: '2026-10-06 18:41'
labels:
  - bug
dependencies: []
priority: high
ordinal: 186008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Observed 2026-10-06 at 17:44-17:45 UTC on TASK-2668.02: the resolver fixed handoff.ts and ran git rebase --continue, which returned status 1 on the next ordinary conflict in package.json and package-lock.json. It explicitly stopped because the prompt says "If a command fails, report the failure and stop", despite also instructing it to repeat until rebase completion. The agent returned exit code 0 with the rebase unfinished; operator continuation was required.

Make conflict-resolution guidance and workflow verification distinguish expected Git conflict pauses from actual command, hook, verification, or infrastructure failures. Resolve successive shared conflicts until completion, within the existing bounded recovery policy. Stage the full resolved conflict set before continuing. Do not treat an agent exit code of zero as proof that Git completed. Preserve real failure diagnostics and fail closed when the rebase remains unfinished.

Relevant authorities: src/application/agent-completion-contract.ts, src/application/rebase-workflow.ts (buildRebasePrompt and resolveSharedConflicts). Retained evidence: .workflow/run-history/task-2668_02/execute-codex-a1-muwyxj66/stderr/000000000000.log in the TASK-2668.02 worktree. The stale pre-commit version bump (1.5.282 versus main 1.5.283) is a concrete successive-conflict reproduction, not evidence that all version conflicts need automatic resolution. Related completed TASK-2582 covers repair lifecycle authority; do not duplicate or relax it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Retain a focused reproduction in the owning rebase recovery/prompt suite that fails on parent behavior and passes with the fix for successive conflict pauses, including a stale version-bump conflict.
- [ ] #2 Conflict-resolution instructions consistently require continuing expected conflict pauses while stopping and reporting genuine unrecoverable failures; all current conflicts are resolved and staged before each continue.
- [ ] #3 Completion requires verified absence of a rebase in progress; an agent returning zero with an unfinished rebase is reported as incomplete, with bounded recovery and actionable diagnostics.
- [ ] #4 Run focused owning-suite checks and required static analysis; preserve typed ports, adapter boundaries, finite test budgets and existing hook failure safeguards.
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
