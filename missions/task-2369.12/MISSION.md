# Mission: Split forgejo.ts — extract PR operations and git ref helpers (task-2369.12)

## Goal
Move 21 PR/review symbols and 14 git ref helper symbols from `src/adapters/forgejo/forgejo.ts` (1452 lines) into `src/adapters/forgejo/forgejo-pr.ts` and `src/adapters/forgejo/forgejo-git.ts` so the main adapter drops below 800 lines and callers can import PR or git concerns independently.

## Why Now
Task-2369.11 extracted auth/token helpers and brought `forgejo.ts` from 1700 to 1452 lines. PR CRUD and git push/fetch/ref helpers are the next two self-contained concerns. PR functions depend on `forgejo-api.ts` + `forgejo-auth.ts`; git functions depend on `git.js` + `forgejo-auth.ts`. Both groups are already imported independently by callers (`integrate.ts`, `review-adapter.ts`, `gatekeeper.ts`, `setup-review.ts`, `rebase-workflow-adapter.ts`). Completing this split finishes the forgejo adapter decomposition.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: pure extraction refactor, no signature or behavior change, re-exports preserve all import paths

## Scope
- Create `src/adapters/forgejo/forgejo-pr.ts` with 21 symbols:
  - PR CRUD: `createPr()`, `getPrNumber()`, `getPrAuthor()`, `resolvePrAccess()`, `listOpenPrsForSlug()`, `closePr()`
  - PR status/info: `getPrStatus()`, `isApiErrorResult()`, `formatPrLookupFailure()`
  - Comments: `getComments()`, `getCommentsSync()`, `postComment()`
  - Reviews: `REVIEW_OUTCOME_MAP`, `postReview()`, `getLatestReview()`, `getLatestReviewDecision()`, `getLatestDisposition()`, `getLatestReviewForPr()`, `getLatestDispositionForPr()`
  - URL helpers: `authenticatedReviewUrl()`, `reviewRemoteUrl()`
- Create `src/adapters/forgejo/forgejo-git.ts` with 14 symbols:
  - Sync/push: `syncPrimaryBaseline()`, `ensureRemoteBaseBranch()`, `pushReviewRef()`, `syncMerged()`
  - Fetch/delete: `fetchReviewBranch()`, `deleteReviewRef()`
  - Ref inspection: `resolveTrackingBranchSha()`, `verifyCommitExists()`, `remoteRefContainsCommit()`
  - Build/parse: `buildCreatePrPushArgs()`
  - Utilities: `cLocaleEnv()`, `pushOutput()`, `isMissingRemoteRef()`, `isStaleInfoPushRejection()`
- Remove extracted symbols from `forgejo.ts` and add re-exports from `forgejo-pr.ts` and `forgejo-git.ts` so all existing import paths through `forgejo.ts` continue to work
- Each new file declares its own imports (`forgejo-api.ts`, `forgejo-auth.ts`, `git.js`, `mission-utils.js`, `backlog.js`, `verification.js`, `cli-format.js`, `child_process`)
- No changes to function signatures, logic, or behavior

## Out of Scope
- Renaming or restructuring any extracted function
- Updating import paths in consumer files (re-exports cover this)
- Adding new tests for extracted functions (existing test coverage via callers is sufficient)
- Extracting `forgejoApi`, `forgejoApiAsync`, or `codexSandboxHint` (those remain in `forgejo-api.ts`)
- Extracting auth/token symbols (already done in task-2369.11)

## Success Criteria
- SC1: `src/adapters/forgejo/forgejo-pr.ts` exists and exports all 21 PR symbols listed in Scope
- SC2: `src/adapters/forgejo/forgejo-git.ts` exists and exports all 14 git symbols listed in Scope
- SC3: `forgejo.ts` re-exports all 35 extracted symbols (from `forgejo-pr.ts` and `forgejo-git.ts`; no copy, re-export only)
- SC4: `forgejo.ts` line count is below 800
- SC5: `./scripts/verify-local.sh static-analysis` passes (ESLint + tsc --checkJs)
- SC6: No runtime behavior change — all existing callers resolve without modification

## Risks and Assumptions
- `codexSandboxHint()` is used by both PR and git functions; it lives in `forgejo-api.ts` and must be imported by both new files
- `resolvePrAccess()` and `getPrAuthor()` depend on `getPrNumber()` via an injectable `resolvePrNumber` option — `getPrNumber` must remain accessible within `forgejo-pr.ts`
- `syncMerged()` (~170 lines) is the largest single function extracted; it references PR helpers (`getPrNumber` via `resolvePrNumber`) and git helpers internally — it belongs in `forgejo-git.ts` per the backlog task, and must import `getPrNumber` from `forgejo-pr.ts` or accept it via options
- `createPr()` references `syncPrimaryBaseline`, `ensureRemoteBaseBranch`, `authenticatedReviewUrl`, `pushReviewRef`, and `fetchReviewBranch` — all extracted. `createPr` lives in `forgejo-pr.ts` and must import the git helpers from `forgejo-git.ts`
- Circular import risk between `forgejo-pr.ts` and `forgejo-git.ts` via `createPr` → git helpers and `syncMerged` → `getPrNumber`. Mitigated by the existing `resolvePrNumber` injection pattern already used in the codebase.

## Checkpoints
- CP 1: Extract PR symbols into `forgejo-pr.ts`, remove from `forgejo.ts`, add re-exports. Verify `forgejo-pr.ts` imports resolve and static analysis passes.
- CP 2: Extract git symbols into `forgejo-git.ts`, remove from `forgejo.ts`, add re-exports. Verify line count < 800 and full static analysis passes.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using durable, verifiable references. Parallix already accepts:
  1. **Recognized repo commands or paths** — e.g., `` `./scripts/verify-local.sh static-analysis` ``
  2. **Test names** — e.g., `"real custom-agent launcher smoke: full lifecycle with hello-world task"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/px-runner.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0039` (must correspond to an existing file under `docs/adr/`)
  5. **File:line references** — accepted when needed, but line numbers eventually rot; prefer the forms above
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above. For example, `wc -l` output alone is not enough; pair with the file path `src/adapters/forgejo/forgejo.ts` and the SC4 criterion.
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| forgejo-pr.ts exports all 21 PR symbols | `src/adapters/forgejo/forgejo-pr.ts` — grep `export` yields 21 named exports | PASS |
| forgejo.ts re-exports all 21 symbols | `src/adapters/forgejo/forgejo.ts` re-export block references `forgejo-pr.js` | PASS |
| Static analysis passes | `./scripts/verify-local.sh static-analysis` | PASS |

## Gates
- [ ] `./scripts/verify-local.sh static-analysis`

## Restricted Areas
- `src/adapters/forgejo/forgejo-api.ts` — do not modify (not in scope)
- `src/adapters/forgejo/forgejo-auth.ts` — do not modify (completed in task-2369.11)
- Consumer files (`integrate.ts`, `review-adapter.ts`, `gatekeeper.ts`, `setup-review.ts`, `rebase-workflow-adapter.ts`, etc.) — do not update import paths; re-exports must cover them

## Stop Rules
- Do not rename any function or change its signature
- Do not add new tests; existing caller coverage is sufficient
- Do not merge `forgejo-pr.ts` and `forgejo-git.ts` into a single file; the backlog task specifies two files
- If circular import between `forgejo-pr.ts` and `forgejo-git.ts` blocks compilation, use the existing `resolvePrNumber` injection pattern (pass function via options) rather than restructuring calls
- If `forgejo.ts` line count is still above 800 after both extractions, re-check that no extracted function body was left behind
