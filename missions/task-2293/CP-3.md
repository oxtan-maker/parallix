# CP-3

## Summary

Completed the remaining TASK-2276 converted-suite population. The scoped inventory contains 158 converted `test/**/*.test.ts` files; its TASK-2277 marker count is now zero. The two retained markers are confined to the out-of-scope `test/test-hygiene.test.ts` and `test/typescript-test-authoring.test.ts` suites. Obsolete expectation directives were removed, while the remaining legacy CommonJS fixture diagnostics use adjacent, checked `@ts-expect-error` comments that name the runtime-only property or partial object-literal behavior being exercised.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: every converted mission-base suite has its TASK-2277 marker removed | `missions/task-2276/mission-base-inventory.txt:1`; `test/test-hygiene.test.ts:1`; `test/typescript-test-authoring.test.ts:1` | PASS |
| SC2: the complete converted population typechecks with no stale expectation directives | `npx tsc --noEmit --project tsconfig.test.json`; `test/review.test.ts:75`; `test/spawn-tee.test.ts:26` | PASS |
| SC3: the completed population retains the repository isolation bootstrap during execution | `node --require ./test/bootstrap-parallix-home.js --import tsx --test test/active.test.ts`; `test/bootstrap-parallix-home.js:28`; `test/bootstrap-isolation.test.ts` | PASS |
| SC4: legacy fixture suppressions are checked and locally reasoned | `test/review.test.ts:75`; `test/e2e-real-agent-smoke.test.ts:378`; `test/task-1036-review-fallback.test.ts:78` | PASS |
| SC5: final verification remains for CP-4 | `./scripts/verify-local.sh static-analysis`; `./scripts/verify-local.sh all` | PENDING CP-4 |

Next action: run the static-analysis and all gates on the complete tree, then record final SC1-SC5 evidence in CP-4.
