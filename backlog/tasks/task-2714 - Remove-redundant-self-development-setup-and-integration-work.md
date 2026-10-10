---
id: TASK-2714
title: Remove redundant self-development setup and integration work
status: backlog
assignee: []
created_date: '2026-10-10 09:43'
labels:
  - performance
  - ai-sdlc
dependencies: []
priority: high
ordinal: 215008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement performance review findings 1-3 for Parallix developing itself. Agent execution time is excluded. Coordinate with TASK-2707 (pnpm migration); do not duplicate or conflict with its install changes.

Current evidence: scripts/refresh-global-px.sh explicitly builds then npm pack builds again through package.json prepack; draft setup recursively copies graphify-out, currently 584 MB including dated historical directories; post-integration refresh repeats npm ci after the draft installation.

Operator decision: one dependency installation at draft time per mission; remove other automatic local self-development npm ci calls. Fresh CI dependency provisioning, isolated package-install contract fixtures, and npm global distribution installation are separate concerns. A changed lockfile can leave the base checkout stale: expose this case and provide an explicit repair path rather than silently reinstalling or building against incompatible dependencies. If correctness requires an exception to the single-install policy, present concrete evidence and obtain a subsequent operator decision.

Preserve repository-owned hooks, independent worktree state, release metadata, packed artifact correctness and architecture boundaries.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Post-integration refresh builds the landed distributable exactly once; npm pack lifecycle cannot trigger a duplicate build.
- [ ] #2 Draft copies only graph data and metadata needed for queries and incremental refresh, excluding historical snapshots and unnecessary exports; independent worktree graph updates remain correct.
- [ ] #3 Local self-development performs its sole automatic dependency installation at draft; subsequent active, review, integration and refresh paths do not reinstall dependencies.
- [ ] #4 Changed-lockfile and stale-base-dependency behavior is explicitly handled without a hidden reinstall, stale build or corruption of parallel worktrees; exceptions require operator decision.
- [ ] #5 Coordinate with TASK-2707; preserve fresh CI provisioning and isolated distribution/install contract tests.
- [ ] #6 Measure affected hook durations and copied bytes before/after; extend owning tests, run static-analysis and applicable docs checks, and manually exercise the lifecycle in an isolated home without real DB/statistics changes.
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
