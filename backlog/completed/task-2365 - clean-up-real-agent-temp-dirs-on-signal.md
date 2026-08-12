---
id: TASK-2365
title: reclaim all Parallix-owned temporary directories
status: done
assignee: [codex]
created_date: '2026-08-10 00:00'
updated_date: '2026-08-12 00:00'
labels: [bug, ai_sdlc]
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The original draft hallucinated a smoke-test-only incident. The real `/tmp` inventory is much larger: 1,503 `task-2339-aggregate-*`, 1,212 `node-coverage-*`, 1,010 `codex-home-*`, 1,000 `task-2339-*`, 505 `codex-home-empty-*`, 501 `task-1380-backward-*`, 460 `task-2339-drain-*`, plus `parallix-test-*`, `coverage-gate-*`, `forgejo-sync-*`, `parallix-docs-*`, and real-agent directories. The two current `parallix-real-agent-*` roots are about 185 MiB each, but they are not the dominant leak class.

Audit every Parallix temporary-directory creator in `src/`, `scripts/`, and `test/`. Cleanup must be owned by the process or script that creates the root. For Parallix developing itself, the unit-test runner and verification scripts must register roots before use, remove them on normal completion/failure/`SIGINT`/`SIGTERM`, and recover roots recorded for confirmed-dead processes on the next eligible run after `SIGKILL`. Isolated tests run outside that runner must clean their own roots with `finally`.

Never sweep `/tmp` by prefix or age: it is shared. Cleanup may remove only a path created by the current process or a path in a durable manifest for a confirmed-dead Parallix owner. Existing opt-in diagnostic retention remains supported. `SIGKILL` remains uncatchable; recovery is deferred to a subsequent owner-aware run.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 `test/task-2365-tmp-reclamation.test.ts` is red on the parent commit and green after the fix; it proves recovery of recorded `parallix-real-agent-*`, `node-coverage-*`, `coverage-gate-tmp-*`, `codex-home-*`, and `task-2339-aggregate-*` roots while preserving a live-owner and an unrecorded root.
- [ ] #2 The inventory accounts for every temporary-root creation site in `src/`, `scripts/`, and `test/`, with registration, local `finally` cleanup, or an explicit opt-in retention contract.
- [ ] #3 The self-hosted runner, coverage gate, and owning verification scripts clean their registered roots and manifests before forwarding child failure, `SIGINT`, or `SIGTERM`; cleanup is idempotent.
- [ ] #4 A subsequent eligible run reclaims roots from a durable manifest only after its owner PID is confirmed dead, then removes the manifest record.
- [ ] #5 The real-agent smoke repository and capture roots retain ordinary and opt-in retention behavior while participating in the owner-scoped cleanup contract.
- [ ] #6 Representative test and coverage runs leave no newly created, non-retained Parallix-owned `/tmp` roots after completion.
- [ ] #7 `./scripts/verify-local.sh static-analysis` passes.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Lock the full leak with a red test that uses fake recorded roots for the observed classes and proves no unrecorded or live-owned path is removed.
2. Audit all creation sites and use the existing registration helper or a local `finally`; avoid a second cleanup framework.
3. Fix manifest persistence, recovery, and signal forwarding at every self-hosted runner/script boundary that owns temporary roots.
4. Cover the real-agent harness, run focused tests plus static analysis, and capture the completed inventory as checkpoint evidence.
<!-- SECTION:PLAN:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
