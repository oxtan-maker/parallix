---
id: TASK-2327
title: fix coverage-gate temp directory leaks on SIGKILL
status: refined
assignee: [codex]
created_date: '2026-07-30 09:25'
labels:
  - resource_usage
  - ai_sdlc
  - bug
dependencies:
  - TASK-2326
ordinal: 67900
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Coverage-gate spawns child processes (`spawnSync`) that create temp directories
(`node-coverage-*`, `coverage-gate-tmp-*`, `graphify-*`). Its cleanup handlers
only listen to `exit`, `SIGINT`, and `SIGTERM` — not `SIGKILL`. When the
coverage-gate process or its child is force-killed, these directories are
orphaned in `/tmp/`.

This is the same root cause as TASK-2326's `parallix-test-*` leaks, but
coverage-gate operates independently of the test bootstrap manifest system.

Evidence: ~4,410 `node-coverage-*` and ~2,000 `coverage-gate-tmp-*` directories
were cleaned from `/tmp/` during TASK-2326's sweep, confirming this happens
frequently in practice.

Options:
1. Register coverage-gate's scratch dirs with the same `parallix-test-run-<PID>.json`
   manifest used by the test bootstrap, so `cleanupOrphanedTempDirs()` can reclaim them.
2. Use `registerTempRoot()` from `test/bootstrap-parallix-home.js` if coverage-gate
   is always invoked in a bootstrap-aware context.
3. Add a manifest-based orphan sweep to coverage-gate itself (mirroring the bootstrap
   approach) so it cleans up after SIGKILL'd child processes.

Investigate which option fits best with coverage-gate's architecture and implement.
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
