---
id: TASK-2388
title: Make running-session recovery repository-safe and refresh-visible
status: done
assignee: [custom]
created_date: '2026-08-21 11:03'
labels:
  - bug
  - ai_sdlc
dependencies:
  - TASK-2387
references:
  - src/adapters/agents/running-sessions.ts
  - src/application/projections/board-subscription.ts
  - src/application/projections/board-readers.ts
priority: high
ordinal: 105917
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The bounded OS-process fallback accepts explicit mission slugs from the system-wide process table without proving repository ownership, misses slug-less px commands started below a worktree root, and the board subscription fingerprint omits liveSession and unattributed running-session changes. These defects can suppress attention for an unrelated repository, report a real local session idle, or rebuild without repainting. Keep this mechanism recovery-only and make each observation scoped, conservative, and visible.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 An explicit-slug px process is accepted only when its repository can be associated with the board repository; the same mission slug running in another repository is ignored.
- [ ] #2 Slug-less agent-launching commands started from any directory inside a mission worktree resolve to that mission.
- [ ] #3 Unresolvable repository or worktree evidence remains unknown or ignored according to whether the resulting count can still be trusted; it is never fabricated as a local running session.
- [ ] #4 Board subscription fingerprints include mission liveSession and unattributed running-session state so starts, stops, and attribution changes repaint the open TUI.
- [ ] #5 Focused tests cover cross-repository slug collisions, nested worktree CWDs, and fingerprint-only recovery changes.
- [ ] #6 ./scripts/verify-local.sh static-analysis passes.
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

## Implementation (task-2388)

Completed on mission branch `mission/task-2388`. Recovery scoping in
`src/adapters/agents/running-sessions.ts`: explicit-slug candidates are accepted
only when the process runs inside the board repository (`runsInsideBoardRepo`),
and slug-less commands resolve from a nested working directory via boundary-aware
`resolveWorktree`. `src/application/projections/board-subscription.ts` now
includes per-card `liveSession` and `metrics.unattributedRunningSessions` in
`boardFingerprint` so recovery-only changes repaint the board. Red-to-green
reproduction in `test/task-2388-repro.test.ts`.

AC status: #1–#6 met; `./scripts/verify-local.sh static-analysis` and `all`
pass (1964 tests). See `missions/task-2388/CP-2.md`, `CP-3.md`, `CP-4.md`.
