# CP-3 — Stranded-mission closeout recovery with worktree/branch cleanup

A mission whose squash already landed on the base branch but whose aggregate is
stranded in `active`/`review` by a gate rebound is now closable to `done` with a
non-null `closedAt`, and its worktree and local `mission/<slug>` branch are
removed. The previous flow had no such path: `px integrate` tried to re-land and
aborted on the ineligible lane, and `px recover <slug>` only reconciled the
Backlog task vs. aggregate split — neither closed the stranded mission.

Four pieces:

1. `src/application/integrate/landed-recovery.ts` — `recoverLandedIntegration()`
   recovers the lane through the same authoritative recovery that owns the
   timestamps (never assigns `Mission.status` directly), verifies the lane is
   `integration`/`done`, then closes it via `persistLandedIntegrationOrAbort`
   (`decideIntegration` → `close`) and removes the worktree/branch. Every effect
   is a tested integration port, so the closeout performs zero new remote side
   effects.
2. `src/application/integrate-workflow.ts` — `recoverLandedCloseout()` is wired
   into `runIntegration` and short-circuits the whole run (no rebase, no gates,
   no publish) when `request.recoverLanded` is set.
3. `src/application/integrate/support.ts` — the `--recover-landed` flag on
   `px integrate <slug> --recover-landed` sets `request.recoverLanded`; this is
   the supported command surface for the closeout.
4. `test/task-2517-cp3-landed-closeout.test.ts` — drives the real
   `SqliteMissionStore` + `MissionLifecycleService` + `MissionIntegrationService`
   end to end against a landed squash commit.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC3 a stranded `active`/`review` mission whose squash landed on the base branch closes to `done` with non-null `closedAt` through a supported command | `test/task-2517-cp3-landed-closeout.test.ts` — `TASK-2517 CP-3: stranded active/review mission closes to done with a landed squash` (real store + lifecycle + integration service) | Complete |
| SC3 the closeout is a supported command, not a hidden helper | `px integrate <slug> --recover-landed` parsed in `src/application/integrate/support.ts` (`if (arg === '--recover-landed')`), invoked from `src/application/integrate-workflow.ts` `runIntegration` | Complete |
| SC3 worktree and local `mission/<slug>` branch are removed | `recoverLandedIntegration` rejects when `cleanupMissionWorktree` returns false; `test/task-2517-cp3-landed-closeout.test.ts` covers both successful cleanup and cleanup failure | Complete |
| SC3 no silent recovery — lane flows through workflow transitions, timestamps stay authoritative | `recoverLandedIntegration` calls `recoverMissionForIntegration` (the existing recovery that owns review `startedAt`/approval `decidedAt`) and never assigns `Mission.status` directly | Complete |
| SC3 zero new remote side effects | every effect is a port injected by the test (`findExistingSquashCommit`, `recoverMissionForIntegration`, `persistLandedIntegrationOrAbort`, `cleanupMissionWorktree`, `createAbort`) — no Forgejo/`git push` path is reachable after the squash is already landed | Complete |
| SC6 the closeout recovery is covered by the regression suite | `npm test -- test/task-2517-cp3-landed-closeout.test.ts` | Complete |

Next action: CP-4 — add the `px review`/`px active` landed-payload guards and fix the `px status` cleanup hint.
