# CP-4: Regression coverage added

## Summary

Added targeted regression coverage for stale-proof rejection on both primary publish paths, and
checked the surrounding integration test surface still passes.

### New proof-mismatch regressions

- `finalizeVariantACloseout rejects a stale verification proof before pushing main closeout`
  proves the fast path returns `verification-proof-mismatch` and never pushes.
  Evidence: `test/integrate.test.js:1001-1052`.
- `createPr rejects a verification proof from a different checkout before syncing primary baseline`
  proves the Forgejo baseline sync refuses a borrowed proof and never pushes.
  Evidence: `test/forgejo.test.js:102-149`.

### Supporting integration test wiring

- Shared proof mocks were added to the integrate and Forgejo suites so the existing success-path
  tests continue to exercise the hardened code paths instead of bypassing them.
  Evidence: `test/integrate.test.js:8-26`, `test/task-1039-integrate.test.js:42-59`,
  `test/forgejo.test.js:15-31`.

### Command results

- `node --test test/integrate.test.js test/forgejo.test.js test/task-1039-integrate.test.js`
  -> **117 pass, 0 fail**.

## Goal Check

| Mission item | Status | Evidence |
|---|---|---|
| Regression proves stale proof cannot publish through Variant A closeout | Pass | `test/integrate.test.js:1001-1052` |
| Regression proves borrowed proof cannot sync mirrored primary baseline in Forgejo path | Pass | `test/forgejo.test.js:102-149` |
| Hardened integrate flows still pass their targeted suite | Pass | `node --test test/integrate.test.js test/forgejo.test.js test/task-1039-integrate.test.js` -> 117/117 |

## Next action

Write the final provenance note explaining why squashed history lost the original audit trail and
what boundary this proof restores.
