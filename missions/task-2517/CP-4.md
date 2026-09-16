# CP-4 — `px review`/`px active` landed-payload guards and the fixed `px status` hint

Operators can no longer re-run `px active`/`px review` against a mission whose
payload a rebound already delivered, and `px status` no longer points at a
phantom cleanup script.

Three pieces:

1. `src/adapters/cli/commands/active.ts` — after slug resolution and before any
   implementer launch, `px active <slug>` refuses when the injected
   `payloadLandedFn` reports the payload already landed, failing with a hint that
   names the closeout command `px integrate <slug> --recover-landed`. The guard is
   opt-in through the injected seam, so direct unit callers that omit it keep
   their existing behaviour.
2. `src/adapters/review/review-workflow-adapter.ts` — the same `payloadLandedFn`
guard runs in the production review preflight before any review operation, with
the same closeout hint.
3. `src/composition/create-cli.ts` — wires `payloadLandedFn: (s) => findExistingSquashCommit(rootDir, s) !== null`
into both the `review` and `active` command adapters, so
   the guard uses the git fact (squash is on the base branch), not a file-only
   heuristic.
4. `src/adapters/cli/commands/status.ts` and `src/adapters/cli/commands/status-adapter.ts` —
   the stale-worktree cleanup hint now names a real command
   (`git worktree remove <path> && git branch -D <branch>`) instead of the
   nonexistent `scripts/cleanup-mission-worktree.sh`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC4 `px active <slug>` refuses a landed payload and names the closeout command | `test/task-2517-sc4-landed-guard.test.ts` — `SC4: px active refuses a landed payload and names the closeout command` | Complete |
| SC4 `px review <slug>` refuses a landed payload | `test/task-2517-sc4-landed-guard.test.ts` — `SC4: px review refuses a landed payload` exercises `ReviewWorkflowAdapter`, the production command path | Complete |
| SC4 the guard uses the git landed-payload fact and not a file heuristic | `src/composition/create-cli.ts` wires `payloadLandedFn` from `findExistingSquashCommit` for both review and active | Complete |
| SC5 the `px status` cleanup hint names a real command, not the phantom script | `test/status.test.ts` — `findStaleMissionWorktrees returns git remove command for missing task file` and `findStaleMissionWorktrees returns cleanup command for done task`; `src/adapters/cli/commands/status.ts` emits `git worktree remove <path> && git branch -D <branch>` | Complete |
| SC4 the hint names the supported closeout command | both guards emit `px integrate <slug> --recover-landed`, the command defined in `test/task-2517-cp3-landed-closeout.test.ts` / `src/application/integrate/support.ts` | Complete |

Next action: CP-5 — run the regression suite and static-analysis gate and confirm no focused/unannotated skipped tests.
