# Checkpoint 1 — Integration, rebase, dry-run, gate, and conflict path map

## Summary of work done
Traced the `px integrate` command and the shared rebase workflow to locate the
exact point where integration stopped invoking the rebase, and recorded the
existing test coverage that protects each path. Deliverable of this checkpoint:
the insertion point and the regression surface.

Key findings (all paths resolve to a single rebase invocation site):

- `px integrate` entry: `src/adapters/cli/commands/integrate.ts`. The probe
  merge + backlog-only retry + dead-end lives at lines 579–760; the
  "Rebase the mission branch before integrating" dead-end is at
  `integrate.ts:749`, with `px resolve-conflict` guidance at `integrate.ts:758`
  via `buildConflictResolutionPrompt`.
- Shared rebase workflow: `src/application/rebase-workflow.ts` —
  `runRebaseWorkflow` (policy) and `buildRebasePrompt` at
  `rebase-workflow.ts:144` (the agent-assisted conflict prompt + rebound
  kernel contract). The port is `createRebaseWorkflowPort` in
  `src/adapters/rebase/rebase-workflow-adapter.ts`.
- The step was lost: `rebaseBeforeReviewRound`
  (`src/adapters/review/rebase.ts:145`) runs only at handoff
  (`src/application/handoff-command-use-case.ts:890`) and before review rounds
  (`src/adapters/review/review-loop.ts`). No integrate path in git history
  (`lib/commands/integrate.js`, `src/adapters/cli/commands/integrate-command.ts`,
  `integrate.ts`) ever called the rebase workflow — consistent with a drop
  during the JS→TS / task-2332 / task-2372 consolidation.
- ADR 0043 target resolution: `resolveMissionBaseBranch` in
  `src/adapters/filesystem/mission-utils.ts`; the mission branch name is
  `missionBranchName(slug, baseWorktree)`.

**Shared insertion point (decided):** after preflight passes and before the
integration-mode boundary / gates / probe merge. A dry run reports via a new
non-mutating `predictIntegrationRebase`; the real run delegates to
`runRebaseWorkflow` through `createRebaseWorkflowPort` with an exit-capturing
seam so integrate continues past a clean rebase instead of terminating.

## Existing test coverage that guards these paths
- `test/rebase-use-case.test.ts` — clean rebase, mission-conflict auto-resolve,
  shared-file agent launch, implementer pinning, hook-failure bounce/strand.
  These must keep passing unchanged (out-of-scope workflow is reused, not
  rewritten).
- `test/integrate.test.ts` — 84 tests over the integrate command and
  `buildConflictResolutionPrompt`.
- `test/task-2369.05-integrate-gates.test.ts` — gate helpers now owned by
  `integrate-gates.ts`.

## Goal Check
| Criterion | Evidence | Status |
|---|---|---|
| Locate integrate probe-merge / dead-end site | `src/adapters/cli/commands/integrate.ts:749` (`Rebase the mission branch before integrating`), `:758` (`buildConflictResolutionPrompt`) | Proven |
| Locate shared rebase workflow + conflict prompt | `src/application/rebase-workflow.ts:144` (`buildRebasePrompt`), `createRebaseWorkflowPort` in `src/adapters/rebase/rebase-workflow-adapter.ts` | Proven |
| Confirm no historical integrate→rebase call | history of `lib/commands/integrate.js`, `src/adapters/cli/commands/integrate-command.ts`, `integrate.ts` | Proven |
| Identify ADR 0043 target resolver | `resolveMissionBaseBranch` in `src/adapters/filesystem/mission-utils.ts` | Proven |
| Record existing regression test surface | `test/rebase-use-case.test.ts`, `test/integrate.test.ts`, `test/task-2369.05-integrate-gates.test.ts` | Proven |

## Next action
Write CP-2: focused regression tests for clean rebase ordering, mission-identity
preservation, conflict delegation, and dry-run non-mutation; confirm red before
the behavior change.
