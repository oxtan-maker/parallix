---
id: TASK-2318
title: Fix test temp-directory leaks that exhaust /tmp inodes
status: backlog
assignee: []
created_date: '2026-07-27 09:00'
labels:
  - bug
  - testing
dependencies: []
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
- [ ] #1 `test/bootstrap-parallix-home.js` cleans up temp directories on both `exit` and `SIGTERM` (or uses a single shared root)
- [ ] #2 Every test file under `test/adapters/` that calls `mkdtempSync` has matching cleanup in `after()` or `finally`
- [ ] #3 All `mkdtempSync` calls in `test/stats.test.ts` and `test/stats-merge-conflict.test.ts` have matching cleanup
- [ ] #4 `test/task-1424-post-integrate-publish-reinstall.test.ts` and `test/package-persistent-data.test.ts` clean up auto-created `tempHome`
- [ ] #5 A full `npm test` run leaves zero orphaned `parallix-test-*` directories in `/tmp`
- [ ] #6 Test-hygiene or CI step detects `/tmp` inode exhaustion and reports it as a test failure
- [ ] #7 No focused or unannotated skipped tests were introduced
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
