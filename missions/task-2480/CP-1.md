# CP-1: Red all-files handoff coverage

Added a focused git-blocker handoff test that supplies dirty files from `src/`,
`docs/`, `graphify-out/`, and `backlog/completed/`. Against the pre-change
implementation, the test fails because the existing allowlist returns the
`dirty files include non-mission paths` blocker. The existing bounded-files
case remains green.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Previously rejected dirty paths have a focused handoff regression test | `test/task-2202-repair-handoff-autocommit.test.ts`, `"repairHandoff auto-commits all non-conflicted dirty files for git-blocker handoff repair"` | PASS |
| The new regression is red before the implementation change | `npm test -- test/task-2202-repair-handoff-autocommit.test.ts` | PASS (expected failure) |
| Existing bounded implementation-file behavior remains covered | `test/task-2202-repair-handoff-autocommit.test.ts`, `"repairHandoff auto-commits bounded implementation files for active-step handoff repair"` | PASS |

Next action: Remove the path allowlist from `repairHandoff` and stage the complete non-conflicted porcelain file set in one git-add invocation.
