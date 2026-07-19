# CP-3 — Verification and rollback assessment

## Summary

Verified the mixed JavaScript/TypeScript test setup through all mission gates:
`npm test`, `./scripts/verify-local.sh static-analysis`, and
`./scripts/verify-local.sh all` completed successfully. The TypeScript test
executed under the default runner, and the static-analysis test typecheck
accepted both configured test extensions. `scripts/test-hygiene.sh` passed and
a targeted search found no `.only` or `.skip` declaration in any phase-owned
configuration or test file.

The TypeScript loader uses Node's `--import` flag, so the package and runner
now require Node 20.6 or later. The runner rejects older Node 20 releases
before launching tests, and its default-suite test covers that boundary.

Rollback is self-contained in the phase's test-toolchain paths: the test
typecheck configuration, default test runner, selected TypeScript test, and
its CP-2 record. Reverting those paths restores the previous JavaScript-only
discovery and typecheck configuration without a production-code change.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| `tsconfig.test.json` includes the selected TypeScript test source and retains existing JavaScript test sources | `tsconfig.test.json:13` includes `test/**/*.js`; `tsconfig.test.json:14` includes `test/**/*.ts`; `./scripts/verify-local.sh static-analysis` passed | PASS |
| The normal `npm test` command discovers and passes the selected TypeScript test and pre-existing JavaScript tests | `test/run-default-tests.js:57` accepts both extensions; `test/run-default-tests.js:125` preloads `tsx`; `package.json:17` and `test/run-default-tests.js:8`-`18` require Node 20.6 for that loader; `npm test` passed; `test/bootstrap-isolation.test.js` remains a discovered JavaScript test file | PASS |
| Static analysis passes after the test-toolchain and test-file changes | `./scripts/verify-local.sh static-analysis` passed; its test-project command is configured at `scripts/verify-local.sh:81` | PASS |
| At least one committed test under `test/` has a `.ts` extension, contains a named assertion, and is run by `npm test` | `test/typescript-test-authoring.test.ts:8`, `"TypeScript-authored test records a typed mock interaction"`, and `npm test` | PASS |
| No new `.only` or bare `.skip` test declarations are introduced | `test/typescript-test-authoring.test.ts:1` through `test/typescript-test-authoring.test.ts:19`; `scripts/test-hygiene.sh` passed | PASS |
| Reverting the phase implementation restores a JavaScript-only test tree without unrelated code changes | `tsconfig.test.json:13`-`14`, `package.json:17`, `test/run-default-tests.js:8`-`18`, `:57`, and `:125`-`:127`, plus `test/typescript-test-authoring.test.ts:1`-`:19`, are the phase-owned execution paths; no `lib/` path is changed by the mission diff | PASS |

Next action: commit this corrected final Goal Check for Parallix handoff.
