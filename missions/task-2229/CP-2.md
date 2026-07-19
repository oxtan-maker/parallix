# CP-2 — TypeScript test support and representative test

## Summary

Added `test/**/*.ts` to the test typecheck project while retaining its
`test/**/*.js` include. The default test runner now recognizes both root-level
`.test.js` and `.test.ts` files and supplies the installed `tsx` loader only
when its selected file list includes TypeScript. Added
`test/typescript-test-authoring.test.ts`, an isolated Node test that exercises
a typed in-memory reporter mock.

The focused runner invocation passed, as did `npm run build` followed by the
test TypeScript project check and `bash scripts/test-hygiene.sh`. No
user-facing workflow documentation changed because `npm test` remains the
documented command and this only expands the supported file extension.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Test typecheck configuration includes the selected TypeScript source without dropping JavaScript sources | `tsconfig.test.json:12` and `tsconfig.test.json:13` include both `test/**/*.js` and `test/**/*.ts` | PASS |
| Normal test command discovers the TypeScript test and existing JavaScript tests | `test/run-default-tests.js:41` accepts `.test.js` and `.test.ts`; `test/run-default-tests.js:109` loads `tsx` when TypeScript is selected; `package.json:56` retains `npm test` | PASS (focused runner proof; full command pending CP-3) |
| Static analysis passes after the toolchain change | `npm run build` followed by `npx tsc --noEmit --project tsconfig.test.json` passed; `./scripts/verify-local.sh static-analysis` remains CP-3 gate | PENDING |
| A committed `.ts` test contains a named assertion and is executed by the normal suite | `test/typescript-test-authoring.test.ts:8`; `node test/run-default-tests.js test/typescript-test-authoring.test.ts` passed | PASS |
| No focused or bare skipped declarations are introduced | `scripts/test-hygiene.sh` passed for `test/typescript-test-authoring.test.ts` | PASS |
| The phase implementation can be reverted without unrelated changes | Phase-owned implementation paths are `tsconfig.test.json`, `test/run-default-tests.js`, and `test/typescript-test-authoring.test.ts` | PASS |

Next action: commit the three implementation paths and CP-2, then run the full `npm test`, static-analysis, and all verification gates.
