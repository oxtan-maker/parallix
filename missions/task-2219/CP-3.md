# CP-3: Add mocked transport tests for sync and async paths

## Summary

Created `test/forgejo-api.test.ts` with 25 focused mocked tests covering both `forgejoApi` (sync Curl) and `forgejoApiAsync` (async Node http/https). All tests use `module-mock` facades for `node:child_process`, `node:http`, `node:https`, and `forgejo.ts` to avoid real network calls.

### Test coverage

**Sync path (`forgejoApi`) — 9 tests:**
- `forgejoApi returns ok with parsed JSON on 200`
- `forgejoApi returns ok on 201 with body payload`
- `forgejoApi returns ok=false on 404`
- `forgejoApi returns ok=false on 401 with data preserved`
- `forgejoApi handles malformed JSON response gracefully`
- `forgejoApi returns error on curl spawn failure (status 7 = sandbox)`
- `forgejoApi returns error on curl spawn failure (generic status)`
- `forgejoApi constructs correct URL from settings`
- `forgejoApi uses rootDir option for settings resolution`

**Async path (`forgejoApiAsync`) — 14 tests:**
- `forgejoApiAsync returns ok with parsed JSON on 200`
- `forgejoApiAsync sends body payload on POST`
- `forgejoApiAsync returns ok=false on 404`
- `forgejoApiAsync handles malformed JSON gracefully`
- `forgejoApiAsync returns error on ECONNREFUSED with sandbox hint`
- `forgejoApiAsync returns error on ENOTFOUND`
- `forgejoApiAsync returns error on generic request failure without sandbox hint`
- `forgejoApiAsync returns timeout error`
- `forgejoApiAsync uses custom timeout from options`
- `forgejoApiAsync uses default HTTP_REQUEST_TIMEOUT when no timeout option`
- `forgejoApiAsync uses https transport for https URLs`
- `forgejoApiAsync constructs correct authorization header`
- `forgejoApiAsync sets Content-Length when body is present`
- `forgejoApiAsync omits Content-Length when no body`

**Utility tests — 2 tests:**
- `codexSandboxHint returns expected message`
- `HTTP_REQUEST_TIMEOUT is 5000`

### Mocking approach

All four builtin modules (`node:child_process`, `node:http`, `node:https`) and `forgejo.ts` are registered with `mockModule` so the re-linked `forgejo-api.ts` sees facades. `mock.method()` patches facade entries. `resolveForgejoSettings` is mocked per-test via `mock.method(forgejoModule, 'resolveForgejoSettings', ...)`.

### Forgejo-api.ts update

Changed imports to use `node:` prefix (`node:http`, `node:https`, `node:child_process`) so mock registration matches the module specifiers used by `mockModule`.

### Verification

- `node --test --experimental-test-module-mocks --import tsx test/forgejo-api.test.ts` — 25/25 pass
- `node --test --experimental-test-module-mocks --import tsx test/forgejo*.test.ts` — 131/131 pass (all Forgejo tests)
- `npx eslint src/adapters/forgejo/forgejo-api.ts test/forgejo-api.test.ts` — clean

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Sync success tested | `test/forgejo-api.test.ts`, `"forgejoApi returns ok with parsed JSON on 200"`, `"forgejoApi returns ok on 201 with body payload"` | PASS |
| Sync non-2xx tested | `test/forgejo-api.test.ts`, `"forgejoApi returns ok=false on 404"`, `"forgejoApi returns ok=false on 401 with data preserved"` | PASS |
| Sync malformed JSON tested | `test/forgejo-api.test.ts`, `"forgejoApi handles malformed JSON response gracefully"` | PASS |
| Sync runner failure tested | `test/forgejo-api.test.ts`, `"forgejoApi returns error on curl spawn failure (status 7 = sandbox)"`, `"forgejoApi returns error on curl spawn failure (generic status)"` | PASS |
| Async success tested | `test/forgejo-api.test.ts`, `"forgejoApiAsync returns ok with parsed JSON on 200"`, `"forgejoApiAsync sends body payload on POST"` | PASS |
| Async non-2xx tested | `test/forgejo-api.test.ts`, `"forgejoApiAsync returns ok=false on 404"` | PASS |
| Async malformed JSON tested | `test/forgejo-api.test.ts`, `"forgejoApiAsync handles malformed JSON gracefully"` | PASS |
| Async request failure tested | `test/forgejo-api.test.ts`, `"forgejoApiAsync returns error on ECONNREFUSED with sandbox hint"`, `"forgejoApiAsync returns error on ENOTFOUND"`, `"forgejoApiAsync returns error on generic request failure without sandbox hint"` | PASS |
| Async timeout tested | `test/forgejo-api.test.ts`, `"forgejoApiAsync returns timeout error"` | PASS |
| Request construction verified | `test/forgejo-api.test.ts`, `"forgejoApi constructs correct URL from settings"`, `"forgejoApiAsync constructs correct authorization header"`, `"forgejoApiAsync sets Content-Length when body is present"` | PASS |
| Timeout behavior verified | `test/forgejo-api.test.ts`, `"forgejoApiAsync uses custom timeout from options"`, `"forgejoApiAsync uses default HTTP_REQUEST_TIMEOUT when no timeout option"` | PASS |
| Tests make no real Forgejo call | All tests mock `spawnSync`, `http.request`, `https.request`, and `resolveForgejoSettings` — no network access | PASS |
| Existing Forgejo tests still pass | `test/forgejo*.test.ts` — 131 tests pass | PASS |

Next action: CP-4 — run static-analysis gate, measure diff budget, compile final Goal Check, and commit checkpoint.
