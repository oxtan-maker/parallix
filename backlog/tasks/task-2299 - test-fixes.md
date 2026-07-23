---
id: TASK-2299
title: test fixes
status: active
assignee: [claude]
created_date: '2026-07-23 09:42'
labels: []
dependencies: []
ordinal: 51000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Fix the rebase unit-test regressions caused by execution-root-aware Git command arguments.

  The rebase implementation now invokes Git with a `-C <executionRoot>` prefix, introduced by commit 6f401e34a, but several test fakes still assume the Git subcommand is at args[0]. This causes:

  - `rebase caps failed continue retries when rebase remains active`
    - expected 3 continue attempts, observed 1
  - `rebase reports git output on failed continue attempt`
    - expected failed-continue diagnostics, observed no stderr

  Update the rebase test fixtures/mocks so they correctly recognize root-prefixed Git commands. Prefer a small, explicit argument-normalization helper in the tests over loose matching that could accept incorrect commands.

  Requirements:
  - Keep the production execution-root behavior intact.
  - Preserve assertions covering the three-attempt retry cap.
  - Preserve failed `git rebase --continue` output and hook diagnostics.
  - Audit nearby rebase test fakes for the same stale args[0]/args[1] assumption.
  - Tests must remain hermetic: mock Git and all external dependencies; never access real Forgejo or execute real Git workflows.
  - Verify at minimum:
    `node test/run-default-tests.js test/rebase.test.ts test/rebase_diagnostics.test.ts`
  - Run the appropriate repository verification afterward.
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
