# CP-2: Extract git symbols into forgejo-git.ts, finalize re-exports

## Summary
Extracted 14 git ref helper symbols from `forgejo.ts` into `src/adapters/forgejo/forgejo-git.ts`. Removed extracted symbols from `forgejo.ts` and added re-export lines for both `forgejo-pr.ts` (21 symbols) and `forgejo-git.ts` (14 symbols). `forgejo.ts` now 12 lines — re-export hub only. All existing import paths preserved via re-exports. Static analysis passes.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| forgejo-pr.ts exports all 21 PR symbols | `src/adapters/forgejo/forgejo-pr.ts:962` | PASS |
| forgejo-git.ts exports all 14 git symbols | `src/adapters/forgejo/forgejo-git.ts:451` | PASS |
| forgejo.ts re-exports all 35 extracted symbols | `src/adapters/forgejo/forgejo.ts:6` | PASS |
| forgejo.ts line count below 800 | `wc -l src/adapters/forgejo/forgejo.ts` → 12 | PASS |
| Static analysis passes | `./scripts/verify-local.sh static-analysis` | PASS |
| No runtime behavior change | `test/forgejo.test.ts` (70 tests pass) | PASS |

## Next action
Run `px review task-2369.12 --submit` to submit checkpoint and complete mission.
