# CP 1 — Backlog state-operation inventory

Mapped the production lifecycle surface before changing behavior. All state operations currently resolve task files from the mission worktree unless integration already supplies its base worktree. The shared path will use `resolveBaseWorktree(slug)` so legacy missions target the primary worktree and recorded feature-base missions target that feature worktree.

| Lifecycle route | Command / helper | Current branch context | State operation | Planned focused coverage |
|---|---|---|---|---|
| Draft creation and completion | `runDraftCommand` → `transitionTask` / `transitionVirtual` | `targetWorktree` (mission branch) | writes `backlog`, then `ready` | `test/draft-command.test.js` |
| Execute launch and rollback | `selectLaunchAndRecord` → `transitionTask` | `worktree` (mission branch) | reads prior state and writes `active`; restores prior state/assignee on failed launch | `test/active.test.js` |
| Execute relaunch record | `recordActualImplementer` → `transitionTask` | `worktree` (mission branch) | writes `active` and implementer | `test/active.test.js` |
| Handoff | `performHandoff` → `backlog.transitionTask` | `rootDir` (mission branch) | reads implementer and writes `review` | `test/handoff.test.js` |
| Reviewer outcome helpers | `review-commands` → injected `transitionTaskFn` | `rootDir` / `worktree` (mission branch) | writes `review`, `approved`, or `active` depending on outcome | `test/review-commands.test.js`, `test/review.test.js` |
| Review loop | `review-loop` → injected transition helpers | `worktree` (mission branch) | writes `active`, `review`, and virtual `approved` | `test/review.test.js` |
| Integration | `completeTask`, `setTaskStatus`, and task reads | `baseWorktree` for durable `approved` and `done` writes; legacy mission-worktree metadata is read only when needed for preflight | reads state; writes `approved` and `done` | `test/integrate.test.js` |
| Reporting-only reads | `stats`, `stats-backfill`, `forgejo` | caller root directory | reads status / implementer only; not a mission state transition | existing tests remain unchanged |

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Every production state-operation path is enumerated and assigned a shared branch-selection migration | `lib/commands/draft.ts:269`, `lib/commands/active.ts:209`, `lib/commands/handoff.ts:567`, `lib/review/review-loop.ts:446`, `lib/commands/integrate.ts:727` | PASS |
| Lifecycle transitions will update the integration branch and then rebase the mission branch | `lib/core/mission-utils/worktree.ts:267`, `lib/core/mission-utils/worktree.ts:301`, `lib/commands/rebase.ts:104` | PLANNED |
| Tests cover default main, selected feature branch, every route, and update-before-rebase ordering | `test/draft-command.test.js`, `test/active.test.js`, `test/handoff.test.js`, `test/review.test.js`, `test/integrate.test.js` | PLANNED |
| Metadata preservation is retained | `lib/tools/backlog.ts:525`, `test/backlog.test.js` | PLANNED |
| User-facing documentation describes branch target and rebase | `docs/agents.md:222` | PLANNED |
| Final verifier is run on the completed tree | `./scripts/verify-local.sh all` | PLANNED |

Next action: add one shared lifecycle state-operation helper around `resolveBaseWorktree`, migrate draft, active, handoff, and review routes, then test update-before-rebase ordering.
