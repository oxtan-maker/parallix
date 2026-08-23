---
id: TASK-2407
title: snapshotWorktreeTopology not provided as named export at runtime
status: backlog
assignee: [codex]
created_date: '2026-08-23 14:45'
labels:
  - bug
  - ai_sdlc
dependencies: []
ordinal: 115918
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The integrate/handoff flow fails at handoff step 1.7 (Capturing Net Engineering
Lines) with:

    [FAIL] The requested module '../adapters/git/worktree.js'
           does not provide an export named 'snapshotWorktreeTopology'

`snapshotWorktreeTopology` is declared as a valid named export in
`src/adapters/git/worktree.ts` and imports cleanly in isolation, but the named
export is not statically detectable when the full CLI module graph loads. The
failure only appears on the real integrate/handoff path, not on isolated imports
or the integrate `--dry-run` (the dry run skips NEL capture).

<!-- SECTION:DESCRIPTION:END -->

## Root-cause hypothesis
- `snapshotWorktreeTopology` was introduced in `mission/task-2400`.
- `src/composition/board-projection.ts` imports it at module top level and is
  pulled into the CLI graph via `production-capabilities.ts` / `status-adapter.ts`.
- The ESM named-export detection fails under a circular import in that graph, so
  Node reports the export as missing even though it exists.

## Verification so far
- `git log --oneline -- src/adapters/git/worktree.ts src/composition/board-projection.ts`
  shows mission-2399 did NOT touch either file.
- `node --import tsx -e "import * as wt from './src/adapters/git/worktree.ts' ..."`
  reports `snapshotWorktreeTopology` is a function.
- `npx tsx src/entry/px.ts integrate task-2399 --dry-run` passes (skips NEL).
- Reproduce the failure by running the real integrate/handoff path that executes
  `captureNelAtHandoff` (board projection build triggers the import).

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
