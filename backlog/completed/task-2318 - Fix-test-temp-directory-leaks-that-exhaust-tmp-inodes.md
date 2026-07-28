---
id: TASK-2318
title: Fix test temp-directory leaks that exhaust /tmp inodes
status: done
assignee: [custom]
created_date: '2026-07-27 09:00'
updated_date: '2026-07-28 04:45'
labels:
  - bug
  - user_value
dependencies: []
modified_files:
  - scripts/test-hygiene.sh
  - test/adapters/board-projection-builder-cp3.test.ts
  - test/adapters/concrete-adapters-cp2.test.ts
  - test/adapters/mission-read-adapter.test.ts
  - test/adapters/repository-wins.test.ts
  - test/bootstrap-parallix-home.js
  - test/default-test-suite.test.ts
  - test/package-persistent-data.test.ts
  - test/stats-merge-conflict.test.ts
  - test/stats.test.ts
  - test/task-1424-post-integrate-publish-reinstall.test.ts
  - test/task-2318-temp-directory-leaks.test.js
  - test/test-hygiene.test.ts
  - test/task-2286-native-sea-smoke.test.ts
  - test/task-2286-sea-stop-rules.test.ts
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Test runs leave orphaned temp directories in `/tmp` that exhaust the filesystem inode table (1 M inodes on tmpfs). When inodes hit 100 %, every `fs.mkdtempSync()` call fails with `ENOSPC: no space left on device`, which crashes the test bootstrap and causes cascading test failures across the entire suite.

The defence (integration gate / test suite) fails on review transition because `/tmp` has no free inodes, not because the code is broken. A manual `rm -rf /tmp/parallix-test-*` restores the suite but the leak recurs on every run.

### Root cause

The test bootstrap (`test/bootstrap-parallix-home.js`) creates 8 temp directories per test process via `fs.mkdtempSync()` and registers cleanup on `process.on('exit')`. The `exit` event does **not** fire when the Node test runner terminates child processes via `SIGKILL` (e.g., timeout, `--test-force-exit`) or when a process crashes before the bootstrap finishes loading. Each orphaned process leaves 8 directories behind.

Additionally, 460 `mkdtempSync` calls across the test suite are missing cleanup entirely — the directories are created but never deleted in `after()` or `finally` blocks.

### Observed impact

| Prefix | Orphaned dirs | Source |
|---|---|---|
| `parallix-test-home-` | ~65 000 | `bootstrap-parallix-home.js` line 20 |
| `parallix-test-user-home-` | ~65 000 | `bootstrap-parallix-home.js` line 21 |
| `parallix-test-forgejo-home-` | ~65 000 | `bootstrap-parallix-home.js` line 26 |
| `parallix-test-git-` | ~65 000 | `bootstrap-parallix-home.js` line 87 |
| `parallix-test-curl-` | ~65 000 | `bootstrap-parallix-home.js` line 103 |
| `parallix-test-launchers-` | ~65 000 | `bootstrap-parallix-home.js` line 147 |
| `px-mra-test-` | ~4 950 | `test/adapters/mission-read-adapter.test.ts` |
| `px-board-test-` | ~2 247 | `test/adapters/board-projection-builder-cp3.test.ts` |
| `px-repo-wins-` | ~2 247 | `test/adapters/repository-wins.test.ts` |
| `workflow-stats-` | ~3 624 | `test/stats.test.ts` |
| `workflow-stats-merge-conflict-` | ~2 265 | `test/stats-merge-conflict.test.ts` |
| `px-git-wins-`, `px-gate-wins-`, `px-review-wins-` | ~449 each | `test/adapters/repository-wins.test.ts` |
| `px-agent-test-` | ~450 | `test/adapters/concrete-adapters-cp2.test.ts` |
| `parallix-npm-home-` | ~273 | `test/task-1424-post-integrate-publish-reinstall.test.ts`, `test/package-persistent-data.test.ts` |

Total orphaned: **~420 000+ directories** consuming all 1 M inodes on `/tmp`.

### Fix strategy

1. **Bootstrap (`test/bootstrap-parallix-home.js`)**: Replace `process.on('exit')` cleanup with `process.on('SIGTERM', ...)` + `process.on('exit', ...)` so cleanup runs on both graceful exit and signal termination. Alternatively, use a single shared temp root with a process-ID subdirectory so one cleanup sweep removes all children.

2. **Adapter tests** (`test/adapters/mission-read-adapter.test.ts`, `board-projection-builder-cp3.test.ts`, `repository-wins.test.ts`, `concrete-adapters-cp2.test.ts`): Add `after()` or `finally` blocks that `fs.rmSync(dir, { recursive: true, force: true })` each created temp directory.

3. **Stats tests** (`test/stats.test.ts`, `test/stats-merge-conflict.test.ts`): Audit all 22+ `mkdtempSync` calls in `stats.test.ts` and ensure every one has a matching `finally { fs.rmSync(...) }`. Add cleanup to `stats-merge-conflict.test.ts`.

4. **Npm-home tests** (`test/task-1424-post-integrate-publish-reinstall.test.ts`, `test/package-persistent-data.test.ts`): Clean up the `tempHome` option directory when it is auto-created (not passed in).

5. **Systemic guard** (test-hygiene or CI step): Add a check that fails if `/tmp` inode usage exceeds a threshold (e.g., 80 %) after a test run, so future leaks are caught early.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `test/bootstrap-parallix-home.js` cleans up temp directories on both `exit` and `SIGTERM` (or uses a single shared root)
- [x] #2 Every test file under `test/adapters/` that calls `mkdtempSync` has matching cleanup in `after()` or `finally`
- [x] #3 All `mkdtempSync` calls in `test/stats.test.ts` and `test/stats-merge-conflict.test.ts` have matching cleanup
- [x] #4 `test/task-1424-post-integrate-publish-reinstall.test.ts` and `test/package-persistent-data.test.ts` clean up auto-created `tempHome`
- [x] #5 A full `npm test` run leaves zero orphaned `parallix-test-*` directories in `/tmp`
- [x] #6 Test-hygiene or CI step detects `/tmp` inode exhaustion and reports it as a test failure
- [x] #7 No focused or unannotated skipped tests were introduced
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Take over round-5 review from custom on mission/task-2318 and re-validate the existing implementation before making further changes.
1. Inspect the committed delta against main plus mission handoff/review artifacts to identify likely weak spots, with special attention to the new bootstrap regression test, adapter/stats cleanup coverage, npm-home cleanup, and the /tmp inode guard.
2. Run focused tests for bootstrap cleanup, hygiene guard, adapter cleanup, stats cleanup, and npm-home cleanup to confirm the current branch is actually green and to surface any remaining review gaps.
3. If focused verification finds a defect or brittle assertion, patch only the affected test/bootstrap/hygiene files, then rerun the smallest sufficient coverage.
4. Run the required repository verification gate, capture evidence against the acceptance criteria/DoD, and leave the task ready for review submission or explicitly document the remaining blocker.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-07-28: Codex took over from custom after round 5 hit MAX_ATTEMPTS in review-state. Initial inspection shows the branch is clean relative to the working tree; only mission review metadata differs from review/mission/task-2318, so the next step is verification-first rather than assuming more implementation is required.

2026-07-28: Verification pass completed under Codex takeover. Focused cleanup coverage passed for bootstrap/adapters/stats/npm-home (`node test/run-default-tests.js test/task-2318-temp-directory-leaks.test.js test/test-hygiene.test.ts test/adapters/mission-read-adapter.test.ts test/adapters/board-projection-builder-cp3.test.ts test/adapters/repository-wins.test.ts test/adapters/concrete-adapters-cp2.test.ts test/stats.test.ts test/stats-merge-conflict.test.ts test/task-1424-post-integrate-publish-reinstall.test.ts test/package-persistent-data.test.ts`).

2026-07-28: Final gates are green: `./scripts/verify-local.sh all` passed with 1401/1401 tests, and `./scripts/verify-local.sh static-analysis` passed after tightening the `RunOptions` helper typing in the npm-home tests and clearing two unrelated task-2286 test-typecheck defects that were blocking the repository-wide test typecheck.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Codex took over after round 5 hit MAX_ATTEMPTS, re-verified the task-2318 implementation, and confirmed the mission changes are green under both focused cleanup coverage and the repository verification gates.

Additional follow-up on takeover: fixed `test`-typecheck blockers in `test/task-1424-post-integrate-publish-reinstall.test.ts` and `test/package-persistent-data.test.ts`, plus two minimal task-2286 test typing defects, so `./scripts/verify-local.sh static-analysis` now passes on the final tree.
<!-- SECTION:FINAL_SUMMARY:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [x] #2 Lint and static analysis report clean on every changed file
- [x] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [x] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [x] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
