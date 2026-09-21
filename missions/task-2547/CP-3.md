# CP-3 — Coverage-aware CI-safe execution and LCOV aggregation

## Summary of work done

Made coverage a reporting mode of the CI-safe execution instead of a second
broad pass, and wired the hosted job to aggregate the result.

- `test/run-default-tests.ts`: when `PARALLIX_TEST_COVERAGE=1` (set by the
  `ci-required` workflow), enables Node's built-in coverage
  (`--experimental-test-coverage`, `--test-coverage-lines=0`) and emits one
  lcov per tier: `coverage/.lcov-unit.info` for the unit invocation and
  `coverage/.lcov-integration-ci.info` for the `--integration-ci` invocation.
  Unit and integration-ci stay separate Node invocations (their execution
  semantics require it) but each selected test still runs at most once; the V8
  payload is written repo-locally under `tmp/coverage-v8` so the fragments
  survive into the merge step.
- `src/adapters/verification/coverage-gate.ts`: `coverageTestFiles()` selects
  `unit ∪ integration-ci` through `selectTierFiles()`; added
  `mergeLcov()`/`normalizeLcov()` which union a source/line present in more than
  one fragment by keeping the larger hit count and recomputing `LF`/`LH`, so
  Sonar receives one coherent report instead of duplicated concatenated `DA`
  records (raw concatenation is not used).
- `scripts/coverage-merge.ts` (new): unions the per-tier LCOV fragments into
  `coverage/lcov.info` using `mergeLcov()`.
- `package.json`: added `"coverage:merge"`; dropped the duplicate `--lcov` flag
  from `"test:coverage"` (former `--threshold 0 --lcov` expansion is gone, SC7).
- `.github/workflows/ci-required.yml`: sets `PARALLIX_TEST_COVERAGE: '1'` on the
  CI-safe execution step; replaces the old
  `npm run test:coverage -- --threshold 0 --lcov && npm run sonar` with two
  steps — `npm run coverage:merge` (union the fragments) then `npm run sonar`
  (the single SonarQube Cloud entrypoint, `SONAR_TOKEN` from secrets, trusted
  runs only). No second test pass runs before the scan.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC3 — every unit / integration-ci test runs at most once | `test/run-default-tests.ts` coverage emission, `PARALLIX_TEST_COVERAGE` | PASS |
| SC4 — one Sonar-consumable `coverage/lcov.info`, records merged | `scripts/coverage-merge.ts` + `mergeLcov()` in `src/adapters/verification/coverage-gate.ts` | PASS |
| SC7 — no duplicate `--lcov` expansion | `package.json` `"test:coverage"`, `.github/workflows/ci-required.yml` | PASS |
| SC6 — `npm run test:integration:ci` / `:local` retain populations | `test/lib/test-run-plan.ts` `--integration-ci` / `--integration-local` | PASS |

## Next action:
Proceed to CP-4: add/confirm focused coverage tests for the selector invariant,
the single-execution command boundary, and the correct merged-LCOV behavior,
and confirm local tier paths are preserved.
