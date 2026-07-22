---
id: TASK-2298
title: Strengthen the defence
status: review
assignee: [codex]
created_date: '2026-07-22 06:52'
labels: []
dependencies: []
ordinal: 51000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
# TASK-2298: Make every Parallix defense verify its selected worktree

  ## Goal

  Audit and harden every Parallix defense so it executes against the explicitly selected target worktree. A passing primary checkout must never authorize, mask, or replace verification of a mission worktree. This includes unit tests, integration gates, workflow E2E tests, real-agent smoke tests, publish proofs, rebase/handoff/review paths, and all Parallix self-tests.

  ## Acceptance criteria

  - [ ] Every verification entrypoint accepts or resolves one explicit target root and propagates it through all subprocesses, Git calls, asset/config/task lookup, temporary paths, and publish proofs.
  - [ ] No mission-scoped defense falls back to ambient process.cwd(), package/module location, getPrimaryWorktree(), or another discovered checkout after a mission worktree has been selected.
  - [ ] Audit every use of process.cwd(), getPrimaryWorktree(), resolveWorktree(), rootDir, cwd, and child-process cwd in production defense code. Classify each as primary-only, target-worktree, or invalid; eliminate invalid paths.
  - [ ] Cover all defense layers: verify-local, default/unit test runner, static analysis, integration gate planning/execution, workflow E2E suites, real-agent smoke tests, handoff, checkpoint, review, rebase, Forgejo publication, exact-tree proof, integration, and any pre-push/hook path.
  - [ ] Add two-worktree behavioral tests for each defense family: a passing mission worktree with a failing/dirty/stale primary checkout must pass only when the mission tree is valid; a failing mission worktree must fail even when primary is clean.
  - [ ] Tests prove nested commands preserve the selected worktree through all levels; they must fail if a child command runs in primary or ambient CWD.
  - [ ] Publish APIs reject proof/root/tree/branch mismatches before any remote push.
  - [ ] Primary-root operations remain allowed only where the operation explicitly acts on primary itself, such as syncing the review baseline; those exceptions are documented and independently tested.
  - [ ] Test fixtures use temporary repositories and mocks only—no real Forgejo, no real agent launch, no expensive CLI recursion.
  - [ ] ./scripts/verify-local.sh all and ./scripts/verify-local.sh static-analysis pass.

  This is deliberately broad: the deliverable is an audited, enforced execution-root contract across the whole defense infrastructure, not merely a fix for createPr.
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
