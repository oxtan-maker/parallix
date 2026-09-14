# CP-3 — GitHub-owned integration

Implemented the smallest GitHub PR path. `px integrate` still runs its local
approval and configured gates, then pushes and creates/reads the expected
GitHub PR with `gh`. A pending, closed-unmerged, changed-target, unavailable,
or unexpected-tree observation returns non-success and leaves the mission open.
Only a fresh merged PR with a matching resulting tree records the integration
and closure. Local squash/merge remains unreachable in this mode.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Direct-to-`main` GitHub PR is submitted and externally observed before completion | `src/adapters/github/github-pr.ts`; `test/github-pr-integration.test.ts`: "direct-to-main GitHub PR is accepted as the expected target" | PASS |
| Configured feature-branch target is observed without requiring `main` | `src/adapters/cli/commands/integrate.ts`; `test/github-pr-integration.test.ts`: "developer feature branch is accepted as the GitHub PR target" | PASS |
| Pending PR remains incomplete | `test/github-pr-integration.test.ts`: "pending GitHub PR remains incomplete after local review and gates" | PASS |
| External merge completes only on fresh provider evidence | `src/adapters/cli/commands/integrate.ts`; `test/github-pr-integration.test.ts`: "successful externally owned GitHub merge supplies completion evidence" | PASS |
| Closed-unmerged PR has a recoverable non-success state | `test/github-pr-integration.test.ts`: "closed unmerged GitHub PR reports recoverable state" | PASS |
| Squash/rebase SHA differences require relationship or tree evidence | `src/adapters/github/github-pr.ts`; `test/github-pr-integration.test.ts`: "GitHub squash or rebase merge accepts a different SHA only with matching tree evidence" | PASS |
| Changed target/base and unavailable GitHub are explicit non-success states | `test/github-pr-integration.test.ts`: "GitHub target branch changes report recoverable state"; "unavailable GitHub and local refs cannot produce merge evidence" | PASS |
| Local ref movement cannot prematurely close a `github-pr` mission | `test/task-2500-integrate-mode-dispatch.test.ts`: "github-pr mode waits for GitHub evidence and never reaches the local squash/merge path" | PASS |

Next action: update the graph, run the mission gate, and record final verification evidence.
