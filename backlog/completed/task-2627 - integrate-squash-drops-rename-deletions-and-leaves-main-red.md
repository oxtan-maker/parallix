---
id: TASK-2627
title: integrate squash drops rename deletions and leaves main red
status: done
assignee: [codex]
created_date: '2026-10-01 14:10'
labels:
  - bug
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`px integrate` can land a squash commit whose tree differs from the tree the pre-integration gates verified, and main is red because of it today.

Cause: `capturePayloadPaths` in `src/application/integrate/squash.ts` runs `git diff --cached --name-only -z` with rename detection on. A renamed file is listed only under its new name, so the final `git commit --only -- <paths>` omits the deletion of the old path. The old file stays staged as `D` and is dropped by the later reset. Reproduced in a scratch repo: a squash-merged `git mv` landed with both the old and the new file in HEAD.

Observed: task-2622.10 renamed 8 persistence test files. Its mission tip passed the gates, but commit 3a02ecc99 landed with the 8 old copies still present next to the renamed ones: `test/sqlite-adapter-cp1`, `sqlite-async-cascade-cp3`, `sqlite-importer-cp4`, `sqlite-ports-cp2`, `task-2521.04-legacy-mission-import`, `task-2521.04-legacy-trace-commit.integration`, `task-2521.06-audit.integration` and `task-2521.06-legacy-task-content`. They fail the temp-dir helper guard and have no tier category, so `test/test-categories.test.ts` and `test/default-test-suite.test.ts` are red on main. That blocks every mission that runs the full unit gate (for example `px review --push` on task-2622.11).

Scope:
- Capture the payload with `--no-renames` (as `preflight-checkout.ts` already does), so both sides of a rename are named in the commit pathspec.
- Before committing, verify that the staged payload tree equals the tree of the gated mission tip for every payload path, and fail closed naming the paths when it does not. This guards against the whole class, not only renames.
- Add a red-to-green test that squash-lands a pure rename and a rename with edits, and asserts the old path is absent from HEAD.
- Restore green main: remove the 8 leftovers after confirming each is fully covered by the renamed suites from task-2622.10 (`sqlite-*.integration`, `legacy-*`), so no coverage is lost.
- Add a defence on the tree that actually lands rather than only the mission tip: run the fast tier guards (`test/test-categories.test.ts`, `test/default-test-suite.test.ts`, `test/file-size-cap.test.ts`) against the staged squash before the commit, so a landing that would leave a guard red is rejected instead of moving main. Keep it from duplicating the tree-equality check.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A squash-landed pure rename removes the old path from the landed commit
- [ ] #2 A squash-landed rename with content edits removes the old path from the landed commit
- [ ] #3 Integration fails closed, naming the paths, when the staged payload does not match the gated mission tree
- [ ] #4 The rename test fails against the current capturePayloadPaths and passes after the fix
- [ ] #5 The 8 leftover test files are gone from main and the renamed suites still cover their behavior
- [ ] #6 The unit suite and tier guards pass on main
- [ ] #7 A landing that would leave a tier guard red is rejected before main moves
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
