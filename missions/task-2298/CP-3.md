# CP-3: Harden publication proof identity

## Summary

Verification proofs now carry the branch that was verified. Forgejo publication
rejects a proof whose branch differs from the branch requested for publication
before primary-baseline synchronization, remote push, or API work. The retained
primary-only operation is `syncPrimaryBaseline`: it mirrors the configured
primary branch to the review remote and remains guarded by exact-tree proof
validation before its force push.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Exact-tree proof records the verified branch | `src/platform/runtime/lib/core/verification.ts:35`, `src/platform/runtime/lib/core/verification.ts:307` | PASS |
| Publication rejects branch mismatch before remote push | `src/platform/runtime/lib/tools/forgejo.ts:537`, `"createPr rejects a verification proof for a different branch before any push"` | PASS |
| Publication rejects root/tree mismatch before primary sync or branch push | `src/platform/runtime/lib/core/verification.ts:328`, `src/platform/runtime/lib/core/verification.ts:331`, `"createPr rejects a verification proof from a different checkout before syncing primary baseline"` | PASS |
| Primary-only baseline mirror is explicitly limited and proof-guarded | `src/platform/runtime/lib/tools/forgejo.ts:886`, `src/platform/runtime/lib/tools/forgejo.ts:898`, `ADR 0045` | PASS |
| Forgejo tests use mocks and temporary directories, not a live service | `test/forgejo.test.ts`, `npm test -- test/forgejo.test.ts` | PASS |

Next action: run the complete required verification gates on the committed mission tree and finish the residual call-site audit for any selected-root fallback not covered by CP-2 and CP-3.
