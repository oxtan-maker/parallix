---
id: TASK-2720
title: Use fresh implementer context after completed checkpoints
status: backlog
assignee: []
created_date: '2026-10-11 08:18'
updated_date: '2026-10-11 08:21'
labels:
  - ai_sdlc
dependencies: []
priority: high
ordinal: 219008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement the checkpoint-context result from research mission px-0008: after a completed checkpoint is durably recorded, continue the same mission in a fresh implementer conversation reconstructed from authoritative Mission state and the existing working tree, instead of repeatedly carrying the old conversation with a compaction instruction.

Observed evidence: eleven historical model-matched Ornith 1.5 comparisons used 216,987,803 reported tokens under the current prompted-compaction baseline versus 103,993,144 with fresh checkpoint sessions (-52.1% relative to baseline). MTP: four missions, -53.7%; non-MTP: seven missions, -47.8%; eight of eleven decreased. Tokens include cached input; historical/replay recovery allowances differ, some validation outcomes remain unresolved, and a harness guard affected some final evidence writes. This is a cost signal, not proof of improved delivery reliability. Preserve these limits in the decision rationale.

Scope: checkpoint continuation only, through the existing application-owned workflow and runner boundaries. Replace checkpoint compaction with fresh continuation and remove the superseded checkpoint-specific behavior; do not add a fallback mode, feature flag or parallel legacy path. Preserve compaction at lifecycle boundaries and other sites where research has not yet established a replacement. Document this boundary-specific decision in the context-management ADR. Reconstruct the locked goal, scope, criteria, completed checkpoint evidence, next action and attributable failure diagnostics. Preserve agent/model identity and working-tree/state continuity. A failed or partial checkpoint must remain repair work and must not trigger a false completion/reset loop.

Out of scope: fresh act-on-review (experiment still running), near-window compaction, observation masking, rebase/review/integration policy changes, model-default changes, architecture-principle changes, and rerunning the research cohort. This task does not depend on finishing every experiment in px-0008; verify and use the checkpoint evidence when refining the implementation contract.

Research handoff: proposed ADR 0066 and tools/session-boundary-evaluation/context-management/results.json in the px-0008 research worktree/branch. Preserved replay state is under /mnt/data/code/parallix-research/px-0008/ and /mnt/data/parallix-px-0008-replay-archive/. Keep production implementation out of px-0008.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 After a successfully recorded checkpoint, the next implementer segment uses a new conversation without importing the previous transcript, while preserving the same mission, agent/model selection, working tree and authoritative state.
- [ ] #2 The new conversation receives enough authoritative context to continue the next checkpoint: locked brief and constraints, success criteria, completed evidence, next action and unresolved failure diagnostics; summaries do not replace application-owned authority.
- [ ] #3 Partial or failed checkpoint work remains recoverable without falsely advancing completion, duplicating evidence or repeatedly resetting; final handoff still enforces complete criterion coverage and independent review.
- [ ] #4 Focused coverage in the owning lifecycle/session suites and a manual end-to-end disposable-mission exercise demonstrate a genuine fresh session across two checkpoints, correct durable continuation and final handoff; required static analysis passes.
- [ ] #5 Fresh continuation replaces the completed-checkpoint compaction path without a legacy fallback or mode switch. Compaction at lifecycle boundaries and other unvalidated sites remains unchanged; the ADR documents the measured savings, reliability limits and exact boundary of the change.
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
