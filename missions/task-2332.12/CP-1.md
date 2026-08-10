# CP-1 — RebaseWorkflowPort and RebaseCommandUseCase

## Summary

Defined the application-layer home for the rebase workflow, mirroring the
`IntegrateCommandUseCase` pattern (A1):

- `src/application/ports/rebase-workflow.ts` — new `RebaseWorkflowPort`
  interface. Every external dependency the 950-line CLI adapter imported
  directly is now declared as a port method, grouped by adapter package: git
  (`git`, `detectRebaseState`, `getCurrentBranch`), mission filesystem
  (`inferSlug`, `findMissionDir`, `findMissionArea`, `resolveWorktree`,
  `conventionalWorktreePath`, `missionBranchName`, `resolveMissionBaseBranch`,
  `missionConflictPathPrefix`, `resolvePromptBaseBranch`, `cwd`), agents
  (`startAgent`, `selectAgent`, `workflowLauncherStatus`, `applyAgentFallback`),
  forgejo (`createPr`, `readToken`, `resolveForgejoUser`, `fetchReviewBranch`),
  backlog (`resolveTaskFile`, `getTaskImplementer`, `transitionTask`), review
  (`resolveReviewIdentity`, `readReviewState`, `writeReviewState`,
  `persistReviewState`), config (`isForgejoReviewEnabled`), verification
  (`formatVerificationCommand`), the integrate conflict-resolution contract
  (`resolveConflictsForMission`, R2 — renamed only, no behavior change), and the
  runtime seams (`missionServices`, `handleHookFailureAutoBounce`, `exit`).
- `src/application/rebase-workflow.ts` — the rebase policy moved out of the
  adapter and rewritten against the port: selected-root resolution, base-branch
  ancestry postcondition, conflict classification/auto-resolve, continue-budget
  handling, hook-failure rebounce, agent-assisted resolution, review push, and
  the next-step hints. No adapter import; effects go through the port and output
  through the application-owned `presentation/cli-format` module.
- `src/application/rebase-command-use-case.ts` — `RebaseCommandUseCase` class
  taking a `RebaseWorkflowPort` and exposing `execute(args)`.

Behavior-preservation decisions (R1/R2, Out of Scope):

- `handleHookFailureAutoBounce` keeps its algorithm and `MAX_HOOK_RETRY = 2`
  budget verbatim; only its injection shape changed (an options bag of `*Fn`
  seams became a `HookRebouncePort` slice). The workflow calls it through
  `port.handleHookFailureAutoBounce` when supplied, so the CLI seam that
  narrowed the bounce to `{ startAgentFn, exitFn, missionStore }` can be
  reproduced exactly in CP-2.
- `parseConflictFilesFromGitStatus`, `parseConflictFilesFromRebaseOutput` and
  `buildRebasePrompt` are moved verbatim; `buildRebasePrompt` now receives its
  base-branch and verification-command resolvers as parameters instead of
  importing mission-utils, because the application layer may not import
  adapters.
- Two dedicated port methods (`missionConflictPathPrefix`,
  `resolvePromptBaseBranch`) exist because the pre-extraction command resolved
  those two values from the real mission layout even when the corresponding
  `*Fn` seam was overridden. Routing them separately preserves that behavior.

The CLI adapter is untouched in this checkpoint, so the existing 48 rebase tests
still exercise the pre-extraction path and stay green; CP-2 switches the adapter
over to the use case.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC2: `RebaseCommandUseCase` exists under `src/application/` and accepts a `RebaseWorkflowPort` | `src/application/rebase-command-use-case.ts:5` | PASS |
| SC3: `RebaseWorkflowPort` declared in `src/application/ports/` listing git, agents, forgejo, backlog, review, config, filesystem and verification dependencies as port methods | `src/application/ports/rebase-workflow.ts:39` | PASS |
| Rebase policy moved into the application layer behind the port | `src/application/rebase-workflow.ts:344` (`runRebaseWorkflow`), `src/application/rebase-workflow.ts:58` (`handleHookFailureAutoBounce`) | PASS |
| R1: hook rebounce seam preserved (retry budget and injection point intact) | `src/application/rebase-workflow.ts:45` (`MAX_HOOK_RETRY = 2`), `src/application/ports/rebase-workflow.ts:102` (`handleHookFailureAutoBounce` port seam) | PASS |
| Out of scope preserved: `buildRebasePrompt` / `parseConflictFilesFrom*` algorithms unchanged | `src/application/rebase-workflow.ts:295`, `src/application/rebase-workflow.ts:181`, `src/application/rebase-workflow.ts:207` | PASS |
| Application boundary guard accepts the new application modules | `test/application-boundaries.test.ts`, `"application import guard accepts every file under src/application/"` | PASS |
| SC5 baseline: existing 48 rebase tests still pass | `npm test -- test/rebase.test.ts test/rebase_hardening.test.ts test/rebase_diagnostics.test.ts` (97 pass / 0 fail together with `test/task-2340-hook-rebounce.test.ts` and `test/task-1049-force-push.test.ts`) | PASS |
| SC8 partial: static analysis clean on the new files | `./scripts/verify-local.sh static-analysis` (`npx eslint src/application/rebase-workflow.ts src/application/ports/rebase-workflow.ts src/application/rebase-command-use-case.ts` — no findings; `npm run typecheck` clean) | PASS |

Next action: CP-2 — add `src/adapters/rebase/rebase-workflow-adapter.ts` that builds a `RebaseWorkflowPort` from the concrete adapters plus the existing `*Fn` overrides, reduce `src/adapters/cli/commands/rebase.ts` to a delegating shell over `RebaseCommandUseCase` (SC1), and rerun the 48 existing rebase tests unchanged.
