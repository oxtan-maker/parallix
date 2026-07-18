---
id: TASK-2241
title: Make test and runtime temporary-file writers clean up /tmp
status: ready-for-integration
assignee: [codex]
created_date: '2026-07-13 04:22'
updated_date: '2026-07-13 04:35'
labels:
  - bug
dependencies: []
priority: high
ordinal: 41000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Repeated Parallix test and runtime runs leave substantial temporary data in /tmp. On 2026-07-13, /tmp was 99% full (16 GiB used, 284 MiB free), causing Git lock/index creation failures that surfaced only as the generic handoff error: Could not transition task to review. Visible residue included Node compile cache (~1.2 GiB), retained clones/worktrees, and large real-agent stdout logs. The real-agent smoke test passed again after reclaiming space, and main had no code changes since the last known-good integration other than a version bump. Audit all test and runtime tmp writers, ensure success and failure paths remove files/directories they create, add safe opt-in retention for diagnostics, and make the smoke failure classify temporary-storage exhaustion distinctly from a Parallix lifecycle regression.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Every production and test helper that creates a temporary file or directory has cleanup on both success and failure paths, except explicitly documented opt-in retention.
- [ ] #2 Real-agent smoke stdout/stderr capture files are removed after each run, including launch and timeout failures.
- [ ] #3 Relevant test suites verify cleanup without deleting operator-owned or concurrently active paths.
- [ ] #4 A repeated representative verification run does not leave unbounded new artifacts under /tmp.
- [ ] #5 The real-agent smoke test checks available temporary storage before creating its fixture and fails with an explicit environment/resource classification when capacity is insufficient.
- [ ] #6 Handoff transition failures retain the underlying Git failure detail so ENOSPC and index-lock errors are diagnosable.
- [ ] #7 The smoke harness classifies ENOSPC and Git index/lock creation failures as environment/resource failures rather than Parallix workflow regressions.
<!-- AC:END -->

## Codex Pre-Draft

**Goal:** bound Parallix-owned temporary storage and classify storage exhaustion explicitly without deleting operator-owned diagnostics or active worktrees.

**Scope and proof:** inventory every `mkdtemp`, temporary log, clone/worktree, cache, and runtime writer; assign ownership and cleanup in `finally`/error paths; add an explicit opt-in retention switch; preflight available temp capacity in the real-agent smoke harness; preserve the underlying Git/ENOSPC error through handoff classification.

**Checkpoints:** (1) writer inventory and red cleanup/ENOSPC fixtures; (2) ownership-safe cleanup and retention implementation; (3) repeated-run residue assertion plus focused smoke/handoff verification.

**Stop rule:** never recursively clean shared `/tmp` paths, an operator-selected path, or a still-running worktree; request direction if safe ownership cannot be established for an existing artifact.

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Root-cause investigation (2026-07-13): main differed from known-good integration 6f3f99f03 only by a package-version bump. At 99% /tmp usage, Git could not create lock/index files; handoff collapsed that into the generic review-transition error. After reclaiming space, the TASK-2223 Pi smoke passed.
<!-- SECTION:NOTES:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
