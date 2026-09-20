# CP-3 — Retry and rebase-state repair

## Summary
Implemented the retry and rebase-state repair required by SC5–SC7, then added
focused regression coverage. All changes route through the injected `gitRunner`
and shared rebase workflow seams; no live repository, Forgejo, or agent is
touched in tests.

Behaviour added/changed (`src/application/integrate/rebase.ts`,
`src/application/integrate/landing.ts`, `src/application/integrate-workflow.ts`,
`src/adapters/cli/commands/integrate-conflict.ts`):
- **SC5 resumed landing** — before the integration rebase, integration detects
  an existing mission squash already on the local base. When present it skips
  the rebase and resumes the landing closeout path instead of replaying mission
  history.
- **SC7 integration-time rebase** — the integration rebase inspects the
  *mission* worktree for an active rebase (not the base worktree, which always
  reads clean). It reports the paused rebase with recovery instructions and
  never reports clean while a rebase remains active.
- **SC6 `px rebase`** — `px rebase` no longer emits its clean-completion result
  while a rebase is still active in the mission worktree.

Test coverage (`test/task-2520-*.test.ts`):
- `test/task-2520-resume-landing.test.ts` — retry after a failed `sync-merged`
  with the mission squash already on the local base skips rebase and completes
  the landing closeout.
- `test/task-2520-integrate-rebase-state.test.ts` — integration rebase reports a
  paused rebase in the mission worktree (SC7), aborts when the local base is not
  an ancestor of the mission (SC4), and completes cleanly when no rebase is
  active (SC7).
- `test/task-2520-rebase-inprogress.test.ts` — `px rebase` does not report clean
  completion while a rebase is in progress (SC6), and reports clean only when no
  rebase is active (SC6).

All 9 new tests pass; `tsc --noEmit` clean; ESLint clean.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC5 retry after `sync-merged` skips rebase and resumes landing closeout when mission squash is already on local base | `test/task-2520-resume-landing.test.ts`, `"retry after failed sync-merged skips rebase and resumes landing closeout"` | PASS |
| SC4 integration verifies mission branch is based on the current local base before squash/landing | `test/task-2520-integrate-rebase-state.test.ts`, `"integration rebase aborts when the local base is not an ancestor of the mission (SC4)"` | PASS |
| SC7 integration rebase reports a paused rebase in the mission worktree | `test/task-2520-integrate-rebase-state.test.ts`, `"integration rebase reports a paused rebase in the mission worktree (SC7)"` | PASS |
| SC7 integration rebase completes cleanly when no rebase is active in the mission worktree | `test/task-2520-integrate-rebase-state.test.ts`, `"integration rebase completes cleanly when no rebase is active in the mission worktree (SC7)"` | PASS |
| SC6 `px rebase` does not report clean completion while a rebase is in progress | `test/task-2520-rebase-inprogress.test.ts`, `"px rebase does not report clean completion while a rebase is in progress (SC6)"` | PASS |
| SC6 `px rebase` reports clean completion only when no rebase is active | `test/task-2520-rebase-inprogress.test.ts`, `"px rebase reports clean completion only when no rebase is active (SC6)"` | PASS |
| SC8 scoped regression coverage present | `test/task-2520-resume-landing.test.ts`, `test/task-2520-integrate-rebase-state.test.ts`, `test/task-2520-rebase-inprogress.test.ts` | PASS |
| Typecheck clean | `tsc --noEmit` (exit 0) | PASS |

## Next action
Run the repository gates and record final evidence for every success criterion
(CP-4): `./scripts/verify-local.sh all` and `./scripts/verify-local.sh
static-analysis`, then commit CP-3 and CP-4.
