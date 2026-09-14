# CP-4 — final verification

The `github-pr` integration path is verified. It submits or updates the
reviewed mission branch as a GitHub PR, waits for a fresh matching GitHub merge
observation, and records completion only then. GitHub-owned squash and rebase
results are checked by tree identity, not mission-head SHA equality.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Direct-to-`main` GitHub PR is submitted and externally observed before completion | `src/adapters/github/github-pr.ts`; `test/github-pr-integration.test.ts`: "direct-to-main GitHub PR is accepted as the expected target" | PASS |
| Configured feature-branch target is observed without requiring `main` | `test/github-pr-integration.test.ts`: "developer feature branch is accepted as the GitHub PR target" | PASS |
| Pending PR remains incomplete | `test/github-pr-integration.test.ts`: "pending GitHub PR remains incomplete after local review and gates" | PASS |
| External merge completes only on fresh provider evidence | `src/adapters/cli/commands/integrate.ts`; `test/github-pr-integration.test.ts`: "successful externally owned GitHub merge supplies completion evidence" | PASS |
| Closed-unmerged PR has a recoverable non-success state | `test/github-pr-integration.test.ts`: "closed unmerged GitHub PR reports recoverable state" | PASS |
| Squash/rebase SHA differences require relationship or tree evidence | `test/github-pr-integration.test.ts`: "GitHub squash or rebase merge accepts a different SHA only with matching tree evidence" | PASS |
| Changed target/base and unavailable GitHub are explicit non-success states | `test/github-pr-integration.test.ts`: "GitHub target branch changes report recoverable state"; "unavailable GitHub and local refs cannot produce merge evidence" | PASS |
| Local ref movement cannot prematurely close a `github-pr` mission | `test/task-2500-integrate-mode-dispatch.test.ts`: "github-pr mode waits for GitHub evidence and never reaches the local squash/merge path" | PASS |
| Required mission gate ran | `./scripts/verify-local.sh all` | PASS |

Next action: mission implementation and required verification are complete; retain GitHub as the external merge authority during normal `px integrate` use.
