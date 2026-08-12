# CP-1: Map transport call surface, helpers, injection seams, and existing tests

## Summary

Mapped `src/adapters/forgejo/forgejo.ts` (1852 lines) to identify transport-only vs. domain-only responsibilities.

**Source path:** `src/adapters/forgejo/forgejo.ts` (mission doc references `lib/tools/forgejo.ts` — actual path differs, no rename needed).

### Transport functions to extract (into `src/adapters/forgejo/forgejo-api.ts`)

| Function | Line | Description |
|---|---|---|
| `forgejoApi()` | 315 | Sync Curl-based HTTP transport via `spawnSync` |
| `forgejoApiAsync()` | 380 | Async Node `http`/`https` transport |
| `HTTP_REQUEST_TIMEOUT` | 15 | Default 5000ms timeout constant |
| `codexSandboxHint()` | 19 | Error normalization helper for sandbox detection |

### Transport dependencies on `forgejo.ts`

| Dependency | Used by | Purpose |
|---|---|---|
| `resolveForgejoSettings()` | Both transport functions | Resolve Forgejo URL and repo from config/env |

Both `forgejoApi` and `forgejoApiAsync` call `resolveForgejoSettings(rootDir)` to build the full API URL. This is the only forgejo.ts function the transport layer depends on. `resolveForgejoSettings` itself depends on `resolveReviewAdapter` (from `product-config.js`) and `deriveRepoFromGitRemote` (intra-module).

### Injection seams

All domain functions accept `apiCall` as an injectable option, defaulting to `forgejoApi` or `forgejoApiAsync`:

| Caller | Line | Default | Injection param |
|---|---|---|---|
| `getPrStatus` | 208 | `forgejoApi` | `options.apiCall` |
| `createPr` | 484 | `forgejoApi` | `options.apiCall` |
| `getPrNumber` | 673 | `forgejoApi` | `options.apiCall` |
| `getPrAuthor` | 696 | `forgejoApi` | `options.apiCall` |
| `listOpenPrsForSlug` | 811 | `forgejoApi` | `options.apiCall` |
| `getLatestReview` | 1182 | `forgejoApi` | `options.apiCall` |
| `getLatestReviewForPr` | 1220 | `forgejoApi` | `options.apiCall` |
| `getLatestReviewDecision` | 1300 | `forgejoApi` | `options.apiCall` |
| `getLatestDisposition` | 1338 | `forgejoApiAsync` | `options.apiCall` |
| `getLatestDispositionForPr` | 1362 | `forgejoApiAsync` | `options.apiCall` |
| `postComment` | 1399 | `forgejoApi` | `options.apiCall` |
| `forgejoAvailable` | 1432 | `forgejoApi` | `options.apiCall` |
| `postReview` | 1509 | `forgejoApi` | `options.apiCall` |
| `syncMerged` | 1677 | `forgejoApi` | `options.apiCall` |
| `closePr` (direct) | 1784 | n/a | calls `forgejoApi` directly |
| `closePr` (direct) | 1788 | n/a | calls `forgejoApi` directly |

### Functions remaining in `forgejo.ts`

**Settings/auth:** `resolveForgejoUser`, `resolveForgejoHome`, `isForgejoPath`, `normalizePathForComparison`, `resolveForgejoSettings`, `resolveForgejoAuth`, `resolveTokenFile`, `readToken`, `listGitWorktrees`, `deriveRepoFromGitRemote`, `cacheKey`, `derivedRepoCache`

**Domain operations:** `getPrStatus`, `createPr`, `getPrNumber`, `getPrAuthor`, `listOpenPrsForSlug`, `isApiErrorResult`, `getLatestReview`, `getLatestReviewForPr`, `getLatestReviewDecision`, `getLatestDisposition`, `getLatestDispositionForPr`, `postComment`, `forgejoAvailable`, `postReview`, `syncMerged`, `pushReviewRef`, `isStaleInfoPushRejection`, `fetchReviewBranch`, `deleteReviewRef`, `verifyCommitExists`, `remoteRefContainsCommit`, `resolveTrackingBranchSha`, `getCommentsSync`, `getComments`, `closePr`, `formatPrLookupFailure`, `reviewRemoteUrl`, `authenticatedReviewUrl`, `syncPrimaryBaseline`, `ensureRemoteBaseBranch`, `resolvePrAccess`

**Constants:** `DISPOSITION_PATTERN`, `DEFAULT_FORGEJO_USER`, `noopLog`

### Existing tests

| File | Coverage |
|---|---|
| `test/forgejo.test.ts` | Domain operations only (mock `apiCall` param). No direct transport tests. |
| `test/forgejo-identity-regression.test.ts` | PR identity regression |
| `test/forgejo-lookup.test.ts` | PR lookup edge cases |
| `test/forgejo-independence.test.ts` | Module independence |
| `test/forgejo-pr-round-sync.test.ts` | PR round-trip sync |

No tests exercise `forgejoApi` or `forgejoApiAsync` directly (no `spawnSync` mock, no `http`/`https` mock). CP3 will add these.

### Extraction plan

1. Create `src/adapters/forgejo/forgejo-api.ts` with `forgejoApi`, `forgejoApiAsync`, `HTTP_REQUEST_TIMEOUT`, `codexSandboxHint`
2. `forgejo-api.ts` imports `resolveForgejoSettings` from `forgejo.ts` (circular ESM import — safe, both functions invoked at call time only)
3. `forgejo.ts` imports + re-exports `forgejoApi`, `forgejoApiAsync` from `forgejo-api.ts`
4. Remove `forgejoApi`, `forgejoApiAsync`, `HTTP_REQUEST_TIMEOUT`, `codexSandboxHint` definitions from `forgejo.ts`
5. Add transport tests in `test/forgejo-api.test.ts` mocking `spawnSync` and `http`/`https`

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Transport call surface mapped | `src/adapters/forgejo/forgejo.ts` lines 315-460, injection points at lines 208, 484, 673, 696, 811, 1182, 1220, 1300, 1338, 1362, 1399, 1432, 1509, 1677, 1784, 1788 | PASS |
| Transport-only helpers identified | `forgejoApi`, `forgejoApiAsync`, `HTTP_REQUEST_TIMEOUT`, `codexSandboxHint` — no domain ops mixed in | PASS |
| Injection seams documented | 16 injection points across domain functions, all use `apiCall` param pattern | PASS |
| Existing Forgejo tests inventoried | `test/forgejo.test.ts`, `test/forgejo-identity-regression.test.ts`, `test/forgejo-lookup.test.ts`, `test/forgejo-independence.test.ts`, `test/forgejo-pr-round-sync.test.ts` | PASS |
| Extraction plan defined | `src/adapters/forgejo/forgejo-api.ts` new module, circular ESM import of `resolveForgejoSettings` | PASS |

Next action: CP-2 — create `src/adapters/forgejo/forgejo-api.ts` with extracted transport functions and update `forgejo.ts` to import and re-export.
