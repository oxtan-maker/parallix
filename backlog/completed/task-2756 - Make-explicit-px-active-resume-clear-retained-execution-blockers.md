---
id: TASK-2756
title: Make explicit px active resume clear retained execution blockers
status: done
assignee: [codex]
created_date: '2026-10-15 07:38'
labels:
  - ai_sdlc
  - bug
dependencies: []
priority: high
ordinal: 246008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-2751 demonstrates a restart deadlock: the operator corrected the contradictory budget criterion and ran px active, but execution stopped again on CP-6's retained human-only-contract-blocker. The blocker is persisted in the operator SQLite database in mission_checkpoints.repair_json under repair.blocker, independently of review findings; the mission remains active. px active currently launches execution without clearing it. The documented checkpoint record --force recovery requires final-checkpoint coverage for unfinished work, and does not refresh authorizedCriteria to the amended contract, so it cannot provide a clean resume. The harness then prints Implementation complete despite the agent explicitly reporting no implementation and a blocked stop.

Make an explicit operator invocation of px active the supported resume action: acknowledge and clear retained execution/contract stops, refresh affected repair authorization to the current recorded contract, and resume unfinished work. Distinguish retained stops from genuinely new blockers discovered after restart. Keep the prior blocker, proposal and operator acknowledgment auditable. Preserve checkpoint evidence, incomplete criteria, declared gates and independent review; clearing a stop must not claim implementation, evidence readiness or verified repair. Do not require a separate operator-resolution command or fake Goal Check evidence. Automatic retries and supervision must not silently exercise this operator authority.

Trace src/application/execute-mission-service.ts, execute-handoff-service.ts, repair-checkpoint-service.ts, mission-checkpoint-service.ts, and src/adapters/cli/commands/active.ts. This complements TASK-2718's execute-stop routing problem; inspect its current archive/status before linking implementation. Use existing owning suites and ADR 0057. Any architectural-principle change requires the repository's explicit decision process.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 An explicit operator px active invocation clears retained execution/contract stops before agent launch and refreshes affected repair authorization to the current recorded criteria and gates, with an auditable acknowledgment; ordinary review decisions are preserved.
- [ ] #2 The TASK-2751 scenario resumes unfinished checkpoints after the criterion correction without separate resolution commands, fabricated evidence, completion flags or bypassed gates; valid prior evidence remains available.
- [ ] #3 Automatic retries, supervisor invocations and fresh blockers discovered after resume do not inherit authority to silently clear stops; distinguish explicit operator activation at the application boundary.
- [ ] #4 Blocked agent termination is reported as blocked rather than Implementation complete, with the concrete reason visible in status and operator output.
- [ ] #5 Extend owning contracts with isolated red-on-parent, green-with-fix reproductions covering restart, amended repair authorization, preserved evidence and gates, automatic invocation and a new blocker after resume.
- [ ] #6 Document px active resume semantics; run focused contracts, static analysis and docs checks, and manually exercise the composed public CLI using disposable state.
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
