# CP-2: Re-export extracted Forgejo auth helpers

Replaced the extracted implementations in `forgejo.ts` with a single re-export and updated `forgejo-api.ts` to import settings directly from `forgejo-auth.ts`. This preserves existing consumer imports while removing the prior circular dependency. The Forgejo test now registers the extracted module at the ESM mocking seam, so its worktree-discovery helpers retain the existing mocked dependency behavior.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Auth module exports all 14 scoped helpers | `src/adapters/forgejo/forgejo-auth.ts:147` | PASS |
| Main adapter re-exports all 14 helpers without duplication | `src/adapters/forgejo/forgejo.ts:107` | PASS |
| Main adapter is within the required line-count range | `wc -l src/adapters/forgejo/forgejo.ts` → 1452 | PASS |
| Forgejo API imports settings from the auth module | `src/adapters/forgejo/forgejo-api.ts:4` | PASS |
| Worktree-discovery test uses the extracted module mock | `npx tsx --experimental-test-module-mocks --test test/forgejo.test.ts` → `resolveTokenFile discovers Forgejo tokens from sibling feature-branch worktrees` | PASS |
| Integration-tier test suite covers the moved module boundary | `npm run test:integration` | PASS |
| Static analysis passes | `./scripts/verify-local.sh static-analysis` | PASS |

Next action: Hand the corrected ESM mock seam and refreshed verification evidence back to the reviewer.
