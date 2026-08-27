# CP-3: Verify the shared UI path

The `px` UI dispatches its active action through the shared board controller and execution adapter, which forwards the resolved mission worktree to the same Backlog transition seam used by direct lifecycle commands. User-facing workflow guidance now records that ownership boundary. Focused tests, static analysis, and final verification pass on the reviewed tree.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| A lifecycle transition from a mission worktree writes only that worktree | `test/backlog.test.ts` — "transitionTask commits only the mission worktree task when invoked from a sibling mission worktree" | PASS |
| A `px` UI transition from a mission worktree has no primary-branch routing dependency | `test/command-dispatch-convergence.test.ts` — "TUI dispatches through same BoardCommandController type"; `test/active.test.ts` — "selectLaunchAndRecord writes Backlog with the launched agent after a successful launch" | PASS |
| Focused coverage proves direct and UI-originated worktree-local writes | `npm test -- --test-name-pattern='(transitionTask (updates status and implementer|commits only the mission worktree task)|selectLaunchAndRecord writes Backlog with the launched agent after a successful launch|TUI dispatches through same BoardCommandController type)' test/backlog.test.ts test/active.test.ts test/command-dispatch-convergence.test.ts` | PASS |
| Existing lifecycle behavior outside task-write location remains covered without new skipped tests | `./scripts/verify-local.sh static-analysis` | PASS |
| Final mission tree passes the required verifier | `./scripts/verify-local.sh all` | PASS: 2160 tests passed |

Next action: Return the committed review corrections to the reviewer for a formal decision.
