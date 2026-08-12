# CP-2: Extract transport into dedicated module, preserve re-exports

## Summary

Created `src/adapters/forgejo/forgejo-api.ts` with `forgejoApi`, `forgejoApiAsync`, `HTTP_REQUEST_TIMEOUT`, and `codexSandboxHint`. Updated `src/adapters/forgejo/forgejo.ts` to import from the new module and re-export `forgejoApi`/`forgejoApiAsync` for public API compatibility.

### Changes

**New file: `src/adapters/forgejo/forgejo-api.ts`**
- `forgejoApi()` — sync Curl transport via `spawnSync`
- `forgejoApiAsync()` — async Node `http`/`https` transport
- `HTTP_REQUEST_TIMEOUT` — 5000ms default timeout constant
- `codexSandboxHint()` — error message helper for sandbox detection
- Imports `resolveForgejoSettings` from `forgejo.ts` (circular ESM import, safe — both functions invoked at call time only)

**Modified: `src/adapters/forgejo/forgejo.ts`**
- Removed local definitions of `forgejoApi`, `forgejoApiAsync`, `HTTP_REQUEST_TIMEOUT`, `codexSandboxHint`
- Added `import { forgejoApi, forgejoApiAsync, codexSandboxHint, HTTP_REQUEST_TIMEOUT } from './forgejo-api.js'`
- Removed `import * as https from 'https'` (no longer needed — was only used by `forgejoApiAsync`)
- Retained `import * as http from 'http'` (used by `forgejoAvailable`)
- Re-exports `forgejoApi` and `forgejoApiAsync` in export block (lines 1667-1668) — public API unchanged

### Verification

- `node --test --experimental-test-module-mocks --import tsx test/forgejo.test.ts` — 70 tests pass
- `node --test --experimental-test-module-mocks --import tsx test/forgejo-*.test.ts` — 36 additional tests pass (106 total)
- `npx eslint src/adapters/forgejo/forgejo.ts src/adapters/forgejo/forgejo-api.ts` — clean
- `npm run build` — bundle passes

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Transport functions in dedicated module | `src/adapters/forgejo/forgejo-api.ts` — `forgejoApi`, `forgejoApiAsync`, `HTTP_REQUEST_TIMEOUT`, `codexSandboxHint` | PASS |
| Re-exports preserved from forgejo.ts | `src/adapters/forgejo/forgejo.ts` export block: `export { forgejoApi }`, `export { forgejoApiAsync }` | PASS |
| Settings/auth remain in forgejo.ts | `resolveForgejoSettings`, `resolveForgejoAuth`, `resolveForgejoUser`, `resolveForgejoHome`, `resolveTokenFile`, `readToken`, `isForgejoPath` all in `forgejo.ts` | PASS |
| Domain operations remain in forgejo.ts | `createPr`, `getPrStatus`, `syncMerged`, `postReview`, `postComment`, `getComments`, `closePr` all in `forgejo.ts` | PASS |
| Git operations remain in forgejo.ts | `pushReviewRef`, `fetchReviewBranch`, `deleteReviewRef`, `syncPrimaryBaseline`, `ensureRemoteBaseBranch` all in `forgejo.ts` | PASS |
| Existing tests pass | `test/forgejo.test.ts` (70 tests), `test/forgejo-*.test.ts` (36 tests) — all pass | PASS |
| ESLint clean on changed files | `npx eslint src/adapters/forgejo/forgejo.ts src/adapters/forgejo/forgejo-api.ts` — 0 errors | PASS |
| Build passes | `npm run build` — bundle 3.0 MB, within 5 MB stop rule | PASS |

Next action: CP-3 — add mocked transport tests for sync and async success, non-2xx, malformed JSON, runner/request failure, and timeout cases.
