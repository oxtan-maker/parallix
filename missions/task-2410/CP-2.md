# CP-2: Restore worktree-local writes

The public `transitionTask` lifecycle seam now uses the existing local transition implementation, preserving the caller-provided worktree as the task-file and commit target. The focused sibling-worktree regression verifies both task bytes and the commit location: the mission copy becomes `active` with `codex`, while the primary copy remains `backlog` with `gemini`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| A lifecycle transition from a mission worktree writes only that worktree | `test/backlog.test.ts` — "transitionTask commits only the mission worktree task when invoked from a sibling mission worktree"; `npm test -- --test-name-pattern='transitionTask (updates status and implementer|commits only the mission worktree task)' test/backlog.test.ts` | PASS |
| A `px` UI transition from a mission worktree has no primary-branch routing dependency | `src/interfaces/tui/ui-command.ts`; `src/application/controller/board-controller.ts` | PENDING CP-3 |
| Focused coverage proves direct and UI-originated worktree-local writes | `test/backlog.test.ts` | PENDING UI coverage in CP-3 |
| Existing lifecycle behavior outside task-write location remains covered without new skipped tests | `test/backlog.test.ts` | PASS for the direct transition path |
| Final mission tree passes the required verifier | `./scripts/verify-local.sh all` | PENDING CP-3 |

Next action: Trace the TUI's active-worktree command path to its lifecycle write and add a focused UI-originated regression without introducing a separate UI transition path.
