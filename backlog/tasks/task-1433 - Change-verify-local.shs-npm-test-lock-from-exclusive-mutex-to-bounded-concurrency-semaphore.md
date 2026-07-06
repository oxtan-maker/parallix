---
id: TASK-1433
title: >-
  Change verify-local.sh's npm test lock from exclusive mutex to
  bounded-concurrency semaphore
status: backlog
assignee: []
created_date: '2026-07-05 15:14'
updated_date: '2026-07-05 17:04'
labels:
  - testing
  - performance
  - infra
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`scripts/verify-local.sh`'s `gate_all` (the `all` verification gate, i.e. `npm test`) currently serializes across all mission worktrees using a single `flock` mutex on a lock file in the shared `.git` common dir (`${GIT_COMMON_DIR}/parallix-verify-all.lock`, added on `main` at commit `56904105`). This was a fix for CPU-contention slowdowns when many concurrent mission agents each ran the full `npm test` suite at once, which made the gate step take so long it looked hung.

The mutex approach has a serious downside discovered live: because it is a strict, single-holder lock, if ANY one agent's test run gets stuck (deadlocked, hung, or otherwise never exits — this was directly observed happening from a bug where a test recursively re-invoked `./scripts/verify-local.sh all` for real, self-deadlocking on the same lock its own parent process held), it blocks every other mission agent's verification gate repo-wide, indefinitely, with no way to detect or recover except a human manually finding and killing the stuck process. This is a worse failure mode than the original contention problem: previously, a slow gate degraded gracefully (everyone finished eventually, just slowly); now, one stuck agent can halt the entire fleet's ability to hand off or integrate.

Replace the exclusive mutex with a bounded-concurrency semaphore that allows up to N (configurable, start with a sensible default such as 2) concurrent `npm test` runs across worktrees, instead of exactly 1. This preserves the contention benefit (not everyone hammering CPU at once) while ensuring one stuck agent only consumes one of N slots rather than blocking every other agent. A `flock`-based implementation can achieve this with N separate lock files (or N numbered slots) and a loop that tries each in turn, or an equivalent standard Unix semaphore technique available in bash without new dependencies. Whatever the mechanism, it must not require any new runtime dependency beyond what a bash script can already assume in this repo (see the `flock` availability check already present in `scripts/verify-local.sh`).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 scripts/verify-local.sh's gate_all runs npm test under a bounded-concurrency mechanism (not a single exclusive mutex) that allows up to N concurrent runs across worktrees, where N is easily configurable (e.g. an env var or a constant near the top of the script) and defaults to a documented sensible value
- [ ] #2 A test or reproducible manual demonstration shows that when N slots are all occupied, an (N+1)th concurrent invocation waits rather than proceeding, and when fewer than N are occupied, a new invocation proceeds immediately without waiting
- [ ] #3 A test or reproducible manual demonstration shows that if one concurrent run hangs indefinitely (simulated), the other N-1 slots remain usable by other invocations -- the fleet is not fully blocked by a single stuck run
- [ ] #4 The mechanism works correctly across separate git worktrees of this repo (not just multiple invocations within one worktree), consistent with how mission worktrees are laid out (../<repo>-<slug>)
- [ ] #5 No new external dependency is introduced beyond what scripts/verify-local.sh can already assume (flock is already used and available)
- [ ] #6 Existing behavior when flock is unavailable (falls back to running npm test directly, per the current command -v flock check) is preserved or replaced with an equally safe fallback
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Update 2026-07-05: the exclusive-mutex flock commit this task references (main 56904105) has been reverted (main commit 4d1e3ff7, revert of 56904105) because it caused worse problems live in production use: a stuck/deadlocked run in one worktree blocked every other agent's verification gate repo-wide for extended periods, and separately, long-running legitimate gate runs in other worktrees (e.g. 50+ minutes) starved unrelated agents queued behind them for a very long time. main's scripts/verify-local.sh gate_all is now back to plain `npm test` with no locking at all -- so this task now starts from an unlocked baseline, not from 'replace the mutex.' Any semaphore design must avoid both failure modes: (1) a stuck holder must not permanently consume its slot forever (consider a lock-file staleness/heartbeat check, not just flock's built-in release-on-exit), and (2) even N concurrent slots can still cause long queuing if any one run is unusually slow -- consider whether a slot should have an escape hatch (e.g. a max wait before proceeding unlocked with a warning) rather than blocking indefinitely.
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
