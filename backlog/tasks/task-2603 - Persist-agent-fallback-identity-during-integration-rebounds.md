---
id: TASK-2603
title: Persist agent fallback identity during integration rebounds
status: backlog
assignee: []
created_date: '2026-09-28 04:59'
labels:
  - bug
dependencies: []
priority: high
ordinal: 134008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Observed during task-2550 integration: an integration gate failed, the repair launcher fell back from custom to codex, and px integrate aborted with Review-state persistence failed for mission undefined, phase unknown, round unknown: Operator database unavailable for undefined. The fallback agent could not complete the repair route.

Root cause: the integrate composition passes the review-loop applyAgentFallback adapter directly as the rebound callback. The rebound kernel invokes that callback with only launchResult and original. The review helper requires role, slug, worktree, review state, and mission-store context to persist a changed agent identity. Its optional TypeScript fields and the cast in the CLI adapter hide the mismatch. On a real fallback, undefined slug and null missionStore reach writeReviewState. The same integration seam is used by the squash-commit hook rebound. Tests currently use callbacks that return the original implementer and therefore do not exercise the changed-agent branch.

Bind a mission-aware implementer fallback at the integration adapter boundary and define a typed callback contract that cannot silently pass incomplete context. Preserve the correct mission identity and assignee when a provider fallback occurs. Keep the repair budget and approval invalidation behavior intact.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A gate rebound that falls back to another agent records the new implementer for the correct mission and continues repair and gate verification without an undefined-mission persistence error.
- [ ] #2 A squash-commit hook rebound handles the same changed-agent fallback with valid mission context.
- [ ] #3 Focused red-to-green regression tests exercise a changed-agent fallback through the real integration composition, including the persistence arguments and failure handling.
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
