## CP-1 + CP-2: Extract PR and git symbols from forgejo.ts

### Summary
Extracted 21 PR symbols into `forgejo-pr.ts` and 14 git symbols into `forgejo-git.ts`. Replaced 1452-line `forgejo.ts` with 12-line re-export hub. Both new files declare their own imports; circular dependency between PR and git modules resolved via ESM live bindings (git imports `authenticatedReviewUrl`, `getPrNumber`, `isApiErrorResult` from PR; PR imports git helpers from git).

### Changes
- `src/adapters/forgejo/forgejo-pr.ts` — new, 982 lines, 21 exports
- `src/adapters/forgejo/forgejo-git.ts` — new, 464 lines, 14 exports
- `src/adapters/forgejo/forgejo.ts` — slimmed to 12 lines (re-exports only)

### Circular import resolution
- `forgejo-git.ts` imports `authenticatedReviewUrl`, `getPrNumber`, `isApiErrorResult` from `forgejo-pr.js`
- `forgejo-pr.ts` imports `syncPrimaryBaseline`, `ensureRemoteBaseBranch`, `fetchReviewBranch`, `buildCreatePrPushArgs`, `cLocaleEnv`, `deleteReviewRef`, `isStaleInfoPushRejection` from `forgejo-git.js`
- `syncMerged` uses `getPrNumber` as default for `resolvePrNumber` option — safe via ESM live binding (default evaluated at call time)
- `createPr` uses injected git helpers — no runtime circular call

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| forgejo-pr.ts exports all 21 PR symbols | `src/adapters/forgejo/forgejo-pr.ts` — 21 `export {` lines covering createPr, getPrNumber, getPrAuthor, resolvePrAccess, listOpenPrsForSlug, closePr, getPrStatus, isApiErrorResult, formatPrLookupFailure, getComments, getCommentsSync, postComment, REVIEW_OUTCOME_MAP, postReview, getLatestReview, getLatestReviewDecision, getLatestDisposition, getLatestReviewForPr, getLatestDispositionForPr, authenticatedReviewUrl, reviewRemoteUrl | PASS |
| forgejo-git.ts exports all 14 git symbols | `src/adapters/forgejo/forgejo-git.ts` — 14 `export {` lines covering syncPrimaryBaseline, ensureRemoteBaseBranch, pushReviewRef, fetchReviewBranch, resolveTrackingBranchSha, buildCreatePrPushArgs, deleteReviewRef, verifyCommitExists, remoteRefContainsCommit, syncMerged, cLocaleEnv, pushOutput, isMissingRemoteRef, isStaleInfoPushRejection | PASS |
| forgejo.ts re-exports all 35 symbols | `src/adapters/forgejo/forgejo.ts` — `export { ... } from './forgejo-pr.js'` (21 symbols) + `export { ... } from './forgejo-git.js'` (14 symbols) | PASS |
| forgejo.ts line count below 800 | `src/adapters/forgejo/forgejo.ts` — 12 lines (`wc -l`) | PASS |
| Static analysis passes | `./scripts/verify-local.sh static-analysis` — ESLint + tsc + test-hygiene + test typecheck all PASS | PASS |
| No signature or behavior change | All function bodies copied verbatim from original; re-exports preserve import paths for all consumers | PASS |

Next action: Mission complete — all checkpoints done, gate passed. Hand off to review.

## Gate Result
`./scripts/verify-local.sh static-analysis` — ALL STAGES PASSED (ESLint, tsc, test-hygiene, test typecheck).
