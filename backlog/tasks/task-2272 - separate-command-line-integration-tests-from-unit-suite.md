---
id: TASK-2272
title: separate command-line integration tests from the unit test suite
status: backlog
assignee: []
created_date: '2026-07-16 08:03'
labels: [ai_sdlc]
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The default test suite currently mixes hermetic unit tests with tests that create
temporary Git repositories and execute real command-line tools. Separate tests whose
purpose is to validate real Git, worktree, rebase, index, packaging, or other process
semantics into an explicit command-line integration suite.

Keep ordinary unit tests hermetic by injecting and mocking subprocess runners,
filesystem boundaries, network clients, Forgejo access, packaging commands, and agent
binaries. Real Forgejo must remain prohibited outside explicitly designated E2E tests.

Preserve the existing E2E distinction:

- the deterministic lifecycle E2E uses real Parallix CLI/application rails and real
  Git with controlled agent launchers; and
- the real-agent smoke E2E uses the configured real agent through draft, active,
  review, and integrate.

All suites must create artifacts only in disposable directories and clean them up,
including tarballs produced by packaging or installation coverage.
<!-- SECTION:DESCRIPTION:END -->

## Codex Pre-Draft

**Goal:** make the fast unit suite machine-independent while retaining real command-line
and repository behavior in a separately invoked integration layer.

**Scope and proof:** inventory default-suite subprocess and network access; classify each
case as an accidental unit dependency or intentional command-line behavior test; inject
mocks into unit fixtures; move intentional real-Git/process coverage behind an explicit
integration entry point and integration gate; add hygiene enforcement that rejects
unapproved external access from unit tests.

**Checkpoints:** (1) subprocess/network inventory and suite classification; (2) hermetic
unit-runner enforcement plus fixture migration; (3) command-line integration entry point,
gate wiring, artifact cleanup, and cross-platform verification.

**Stop rule:** do not replace tests of actual Git graph, index, rebase, or worktree
semantics with mocked return values; move those tests intact to the command-line
integration layer. Do not weaken either real-rails E2E.

## Acceptance Criteria

- [ ] The default unit suite does not execute Git, curl, Forgejo requests, packaging commands, or agent binaries.
- [ ] Command-line integration tests are clearly named and invoked independently from unit tests.
- [ ] Real-Git coverage continues to exercise disposable repositories on every supported development platform.
- [ ] Real Forgejo access is rejected from unit tests and allowed only in explicitly designated E2E coverage.
- [ ] Packaging and installation tests leave no tarballs or other generated artifacts in the working tree.
- [ ] The deterministic lifecycle and real-agent lifecycle E2E gates retain their existing real application rails.

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
