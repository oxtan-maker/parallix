# CP-2 — GitHub PR acceptance coverage

Added isolated acceptance coverage for GitHub PR observations. The test doubles
the external read and tree comparison, so it covers pending, merged, closed,
target-change, unavailable, and squash/rebase outcomes without a real GitHub
request. It currently fails because the production GitHub adapter does not yet
exist; CP-3 supplies that adapter and command path.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Direct-to-`main` GitHub PR is submitted and externally observed before completion | `test/github-pr-integration.test.ts`: "direct-to-main GitHub PR is accepted as the expected target" | COVERED (red) |
| Configured feature-branch target is observed without requiring `main` | `test/github-pr-integration.test.ts`: "developer feature branch is accepted as the GitHub PR target" | COVERED (red) |
| Pending PR remains incomplete | `test/github-pr-integration.test.ts`: "pending GitHub PR remains incomplete after local review and gates" | COVERED (red) |
| External merge completes only on fresh provider evidence | `test/github-pr-integration.test.ts`: "successful externally owned GitHub merge supplies completion evidence" | COVERED (red) |
| Closed-unmerged PR has a recoverable non-success state | `test/github-pr-integration.test.ts`: "closed unmerged GitHub PR reports recoverable state" | COVERED (red) |
| Squash/rebase SHA differences require relationship or tree evidence | `test/github-pr-integration.test.ts`: "GitHub squash or rebase merge accepts a different SHA only with matching tree evidence" | COVERED (red) |
| Changed target/base and unavailable GitHub are explicit non-success states | `test/github-pr-integration.test.ts`: "GitHub target branch changes report recoverable state"; "unavailable GitHub and local refs cannot produce merge evidence" | COVERED (red) |
| Local ref movement cannot prematurely close a `github-pr` mission | `test/task-2500-integrate-mode-dispatch.test.ts`; `test/github-pr-integration.test.ts` | COVERED (red) |

Next action: implement the GitHub observation adapter, then route `px integrate` through submit/observe instead of local publish.
