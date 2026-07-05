# Mission: Add runtime smoke test to catch ERR_MODULE_NOT_FOUND before main (task-1408)

## Goal
Add a runtime smoke test to the E2E test suite that executes `node px.ts` without experimental flags and verifies it completes successfully, ensuring that module resolution errors that break the runtime cannot reach the main branch undetected.

## Why Now
A recent state of the repository had px.ts importing non-existent JavaScript modules (e.g., `./lib/core/fmt.js` where only `./lib/core/fmt.ts` exists). Running `node px.ts active` produced an ERR_MODULE_NOT_FOUND error, yet the existing E2E tests all use `node --experimental-strip-types px.ts`, which masks module resolution failures. This left the main branch in a non-runnable state. This mission closes the test gap so that any future regression causing `node px.ts` to fail will be caught before merge.

## Refinement Signals
- Predicted NEL bucket: Small (0-80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: runtime reliability, test coverage gap

## Scope
- Add a new test file at `test/px-runtime-smoke.test.js` that runs `node px.ts --version` without experimental flags
- The test must assert exit code 0 and absence of ERR_MODULE_NOT_FOUND in output
- The test must be discoverable by the existing `npm test` command via the `test/*.test.js` glob

## Out of Scope
- Fixing the underlying import path issue in px.ts (that is a separate fix outside this mission)
- Modifying existing tests in `test/px-runner.test.js` that use `--experimental-strip-types`
- Changing the build configuration or build output directories
- Modifying tsconfig.json or package.json

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- `test/px-runtime-smoke.test.js` exists and contains a test named "px runtime smoke test verifies node px.ts executes without module resolution errors"
- The test invokes `node px.ts --version` without any experimental Node.js flags
- The test asserts `result.status === 0` where result is the spawnSync output from running `node px.ts --version`
- The test asserts that the combined stdout and stderr output does not match /ERR_MODULE_NOT_FOUND/
- The test is a top-level test in the test suite (matches `test/*.test.js` glob)
- Running `npm test` includes and executes this new test

Reproduction-Test: test/px-runtime-smoke.test.js

## Risks and Assumptions
- Assumption: The underlying module import issue in px.ts (importing `.js` files that do not exist) will be resolved separately; this mission only adds the test that would have caught it
- Assumption: Node.js version >= 20 (as per package.json engines) supports the necessary ES module features
- Risk: The test may fail in environments where px.ts has unresolved dependencies; this is the intended behavior (catching the regression)
- Risk: If px.ts is modified to require additional runtime setup, the smoke test may need updates to reflect new prerequisites

## Checkpoints
- CP 1: Create failing reproduction test at `test/px-runtime-smoke.test.js` that runs `node px.ts --version` (without `--experimental-strip-types`) and asserts exit code 0 and no ERR_MODULE_NOT_FOUND in output. At the parent commit of this mission, this test fails (red) because px.ts imports `./lib/core/fmt.js` which does not exist. Once the import paths in px.ts are corrected or the compiled artifacts exist, this test will pass (green).

## Gates
- [ ] ./scripts/verify-local.sh docs
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not modify px.ts import paths (that fix belongs to a separate mission)
- Do not modify tsconfig.json, package.json, or any build scripts
- Do not modify existing test files other than adding the new smoke test file
- Do not change the `test` script in package.json

## Stop Rules
- Stop if adding the test requires modifying the test runner configuration beyond the standard `test/*.test.js` glob
- Stop if the new test cannot be made to run as part of the existing `npm test` command
- Stop if the mission scope expands beyond adding a single reproduction test file
