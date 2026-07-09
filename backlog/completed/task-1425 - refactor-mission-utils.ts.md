---
id: TASK-1425
title: refactor mission-utils.ts
status: done
assignee:
  - claude
created_date: '2026-07-04 17:17'
updated_date: '2026-07-09 16:02'
labels:
  - user_value
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Refactor `lib/core/mission-utils.ts` into smaller, focused internal modules while keeping `lib/core/mission-utils.ts` as the stable facade used by existing commands, review flows, tools, and tests. Preserve the current mission path/worktree/base-branch/graphify/conflict-helper behavior and keep verification green after the split.
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [x] #2 Lint and static analysis report clean on every changed file
- [x] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [x] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [x] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Split lib/core/mission-utils.ts (998 lines) into four focused internal modules under lib/core/mission-utils/ (paths.ts, worktree.ts, graphify.ts, merge-noise.ts), with lib/core/mission-utils.ts converted to a stable facade that re-exports the combined public surface via plain data-property assignments (not accessor re-exports, to keep the facade mockable by node:test's mock.method — this was a real regression caught and fixed during the test-reorg checkpoint). test/mission-utils.test.js (979 lines, 41 tests) was split into four focused test files mirroring the same module boundaries, with every test preserved verbatim. Both required gates pass on the final tree: ./scripts/verify-local.sh static-analysis (ESLint/tsc/test-hygiene all clean) and ./scripts/verify-local.sh all (2060/2060 non-skipped tests passing). No public import path, command behavior, or mission document semantics changed.
<!-- SECTION:FINAL_SUMMARY:END -->
