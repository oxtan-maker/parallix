# CP 2 — Shared integration-branch state path

Introduced the shared public `transitionTask` lifecycle seam, which now resolves the mission's base worktree, updates `backlog.md` there, and rebases the mission worktree afterward. Migrated the draft, active, handoff, review-command, and review-loop routes by retaining their existing `transitionTask` dependency seam. Integration already writes on `baseWorktree`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Every production state-operation path is enumerated and assigned a shared branch-selection migration | `lib/tools/backlog.ts:584`, `lib/commands/draft.ts:269`, `lib/commands/active.ts:209`, `lib/commands/handoff.ts:567`, `lib/review/review-loop.ts:446`, `lib/commands/integrate.ts:727` | PASS |
| Lifecycle transitions update the integration branch and rebase the mission branch afterward | `lib/tools/backlog.ts:594`, `lib/tools/backlog.ts:617`, `"transitionTaskOnIntegrationBranch writes main metadata first and rebases the mission worktree afterward"` | PASS |
| Tests cover default main, selected feature branch, every route, and update-before-rebase ordering | `test/backlog.test.js`, `"transitionTaskOnIntegrationBranch targets a recorded feature base branch"`, `test/draft-command.test.js`, `test/active.test.js`, `test/handoff.test.js`, `test/review.test.js`, `test/integrate.test.js` | PASS |
| Metadata preservation is retained | `test/backlog.test.js`, `"transitionTaskOnIntegrationBranch writes main metadata first and rebases the mission worktree afterward"` | PASS |
| User-facing documentation describes branch target and rebase | `docs/agents.md:226` | PASS |
| Final verifier is run on the completed tree | `./scripts/verify-local.sh all` | PLANNED |

Next action: run the focused backlog lifecycle test and `./scripts/verify-local.sh all`, then record final gate evidence in CP-3.
