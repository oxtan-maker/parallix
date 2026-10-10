---
id: TASK-2714
title: Remove redundant self-development setup and integration work
status: backlog
assignee: []
created_date: '2026-10-10 09:43'
updated_date: '2026-10-10 09:43'
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

Operator decision: one dependency installation at draft time per mission. Post-integration refresh reinstalls dependencies only when dependency inputs changed relative to the successfully installed base environment. Compare dependency semantics, not raw package/lockfile bytes: release version-only changes (including root lockfile version metadata) must not trigger reinstall. Actual dependency, resolution, integrity, install policy or relevant runtime/toolchain changes must invalidate the installed identity. Missing or failed installation identity must recover safely. Record successful identity only after a successful install. Preserve fresh CI provisioning, isolated package-install fixtures and global package distribution installation. Coordinate the identity with TASK-2707's package-manager migration.

Preserve repository-owned hooks, independent worktree state, release metadata, packed artifact correctness and architecture boundaries.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Post-integration refresh builds the landed distributable exactly once; npm pack lifecycle cannot trigger a duplicate build.
- [ ] #2 Draft copies only graph data and metadata needed for queries and incremental refresh, excluding historical snapshots and unnecessary exports; independent worktree graph updates remain correct.
- [ ] #3 Coordinate with TASK-2707; preserve fresh CI provisioning and isolated distribution/install contract tests.
- [ ] #4 Measure affected hook durations and copied bytes before/after; extend owning tests, run static-analysis and applicable docs checks, and manually exercise the lifecycle in an isolated home without real DB/statistics changes.
- [ ] #5 Draft installs dependencies once per mission. Post-integration base dependency reconciliation runs only when the installed dependency identity is missing, invalid or changed; routine active/review/integration paths do not reinstall.
- [ ] #6 Version-only package and root lockfile metadata changes do not invalidate installed dependencies. Actual dependency changes trigger reconciliation before the landed build; failed installs do not publish a successful identity. Owning tests cover both cases and parallel-worktree isolation.
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
